import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { isAbsolute, join } from 'node:path'
import {
  VOICE_LANGUAGES,
  type VoiceLanguage,
  type VoiceLanguageAvailability,
} from '../../../../shared/contracts/dto'
import { VoiceMissingError, VoiceModelsMissingError } from '../../application/VoiceEngine'
import { createVoiceRespeller, type VoiceRespeller } from '../../domain/voiceRespelling'
import { createDownloadProgressTracker } from './downloadProgress'
import { loadPocketTts, type PocketTts } from './pocketTts/PocketTtsSynthesizer'
import type { PocketTtsVoice } from './pocketTts/pocketTtsBundle'
import type { VoiceModelLoader, VoiceModels } from './voiceHostHandler'
import { readVoiceLexicon } from './voiceLexiconFile'
import { WHISPER_DTYPE, WHISPER_MODEL_ID } from './voiceHostProtocol'
import { readWhisperLanguage, readWhisperPromptTokens, steerWhisperPrompt } from './whisperLanguage'

/**
 * Pocket TTS bundles live in `<models>/pocket-tts/<name>/`, voices in `<voices>/<name>.safetensors`
 * and an installation's own respellings in `<voices>/lexicon.<name>.json`.
 */
export const POCKET_TTS_MODELS_SUBDIR = 'pocket-tts'
export const VOICE_LANGUAGE_NAMES: Record<VoiceLanguage, string> = { de: 'german', en: 'english' }

/** The part of transformers.js's `env` that decides where models come from. */
interface TransformersModelEnv {
  allowRemoteModels: boolean
  allowLocalModels: boolean
  localModelPath: string
  useFSCache: boolean
}

/**
 * Models come only from `modelsDir`, which the image fills at build time. With remote models off,
 * a model that is not on disk throws instead of being fetched, and with the file cache off nothing
 * is written into the (read-only) package folder.
 */
export function configureOfflineTransformers(env: TransformersModelEnv, modelsDir: string): void {
  env.allowRemoteModels = false
  env.allowLocalModels = true
  env.localModelPath = modelsDir
  env.useFSCache = false
}

export interface VoiceInstallation {
  /** What is missing for voice to work at all; empty when Whisper and one language are there. */
  missing: string[]
  languages: {
    language: VoiceLanguage
    bundleDir: string
    voicePath: string | null
    /** Where the lexicon would be; it may not exist. Null without a voice directory. */
    lexiconPath: string | null
  }[]
}

/**
 * What the image put in `modelsDir` and the installation put in `voiceDir`. A language is offered
 * when its Pocket TTS bundle is there; it can speak when its voice is there too.
 */
export function findVoiceInstallation(modelsDir: string, voiceDir: string): VoiceInstallation {
  const languages = VOICE_LANGUAGES.map(language => {
    const name = VOICE_LANGUAGE_NAMES[language]
    const voices = isAbsolute(voiceDir) ? voiceDir : null
    const voicePath = voices ? join(voices, `${name}.safetensors`) : null
    return {
      language,
      bundleDir: join(modelsDir, POCKET_TTS_MODELS_SUBDIR, name),
      voicePath: voicePath && existsSync(voicePath) ? voicePath : null,
      lexiconPath: voices ? join(voices, `lexicon.${name}.json`) : null,
    }
  }).filter(entry => existsSync(join(entry.bundleDir, 'bundle.json')))
  const missing = [
    ...(existsSync(join(modelsDir, WHISPER_MODEL_ID, 'config.json')) ? [] : [WHISPER_MODEL_ID]),
    ...(languages.length > 0 ? [] : [`${POCKET_TTS_MODELS_SUBDIR}/<language>`]),
  ]
  return { missing, languages }
}

interface LoadedLanguage {
  tts: PocketTts
  voice: PocketTtsVoice
  respell: VoiceRespeller
}

/**
 * Loads Whisper on onnxruntime-node and finds the speech models; each language's speech model
 * loads on its first reply in it (about 0.8 GB each), so a German-only user never holds English.
 * Runs only inside the voice host process.
 */
export const loadVoiceModels: VoiceModelLoader = async ({ modelsDir, voiceDir }, onProgress) => {
  if (!modelsDir || !isAbsolute(modelsDir)) {
    throw new VoiceModelsMissingError('No voice models directory is configured on this server.')
  }
  const installation = findVoiceInstallation(modelsDir, voiceDir)
  if (installation.missing.length > 0) {
    throw new VoiceModelsMissingError(
      `Voice models missing in ${modelsDir}: ${installation.missing.join(', ')}`,
    )
  }

  const transformers = await import('@huggingface/transformers')
  configureOfflineTransformers(transformers.env, modelsDir)
  // transformers ships an ESM and a CJS build, each its own module instance with its own `env`,
  // and the bundler may turn the import above into a require. Configuring both keeps the offline
  // rule independent of that choice.
  const requireFromHere = createRequire(__filename)
  configureOfflineTransformers(requireFromHere('@huggingface/transformers').env, modelsDir)
  const ort = await import('onnxruntime-node')

  const asr = await transformers.pipeline('automatic-speech-recognition', WHISPER_MODEL_ID, {
    dtype: WHISPER_DTYPE,
    device: 'cpu',
    progress_callback: createDownloadProgressTracker(onProgress),
  })
  const promptTokens = readWhisperPromptTokens(asr.model.generation_config ?? {})

  class SteerWhisperPrompt extends transformers.LogitsProcessor {
    public override _call(inputIds: bigint[][], logits: InstanceType<typeof transformers.Tensor>) {
      inputIds.forEach((sequence, row) => {
        steerWhisperPrompt(sequence.length, logits[row].data as Float32Array, promptTokens)
      })
      return logits
    }
  }

  const loaded = new Map<VoiceLanguage, Promise<LoadedLanguage>>()
  const loadLanguage = (language: VoiceLanguage): Promise<LoadedLanguage> => {
    const entry = installation.languages.find(candidate => candidate.language === language)
    if (!entry) {
      return Promise.reject(new VoiceModelsMissingError(`No speech model for ${language}.`))
    }
    const { voicePath } = entry
    if (!voicePath) {
      return Promise.reject(new VoiceMissingError(`No voice is installed for ${language}.`))
    }
    let pending = loaded.get(language)
    if (!pending) {
      pending = (async () => {
        // Read with the model, so an edited lexicon applies after the host's next idle unload.
        const lexicon = await readVoiceLexicon(entry.lexiconPath, message =>
          process.stderr.write(`${message}\n`),
        )
        const tts = await loadPocketTts(entry.bundleDir, ort)
        try {
          return {
            tts,
            voice: await tts.loadVoice(voicePath),
            respell: createVoiceRespeller(language, lexicon),
          }
        } catch (error) {
          await tts.release()
          throw error
        }
      })()
      pending.catch(() => loaded.delete(language))
      loaded.set(language, pending)
    }
    return pending
  }

  const models: VoiceModels = {
    languages: installation.languages.map(
      ({ language, voicePath }): VoiceLanguageAvailability => ({
        language,
        voiceInstalled: voicePath !== null,
      }),
    ),
    transcribe: async pcm16k => {
      const { input_features: inputFeatures } = await asr.processor(pcm16k)
      const processors = new transformers.LogitsProcessorList()
      processors.push(new SteerWhisperPrompt())
      const output = await asr.model.generate({
        inputs: inputFeatures,
        decoder_input_ids: [promptTokens.startOfTranscript],
        logits_processor: processors,
      })
      const sequence = (output as InstanceType<typeof transformers.Tensor>).tolist()[0] as bigint[]
      return {
        text: asr.tokenizer.decode(sequence, { skip_special_tokens: true }),
        language: readWhisperLanguage(sequence, promptTokens) ?? 'en',
      }
    },
    synthesize: async function* (text, language, signal) {
      const { tts, voice, respell } = await loadLanguage(language)
      for await (const samples of tts.synthesize(respell(text), voice, { signal })) {
        yield { samples, sampleRate: tts.sampleRate }
      }
    },
  }
  return models
}
