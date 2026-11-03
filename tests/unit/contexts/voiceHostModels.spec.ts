import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { env, pipeline } from '@huggingface/transformers'
import { VoiceModelsMissingError } from '../../../src/contexts/voice/application/VoiceEngine'
import {
  configureOfflineTransformers,
  findVoiceInstallation,
  loadVoiceModels,
} from '../../../src/contexts/voice/infrastructure/localEngine/voiceHostModels'
import { WHISPER_MODEL_ID } from '../../../src/contexts/voice/infrastructure/localEngine/voiceHostProtocol'

let modelsDir: string
let voiceDir: string

beforeEach(async () => {
  modelsDir = await mkdtemp(join(tmpdir(), 'voice-models-'))
  voiceDir = await mkdtemp(join(tmpdir(), 'voice-voices-'))
})

afterEach(async () => {
  vi.restoreAllMocks()
  await rm(modelsDir, { recursive: true, force: true })
  await rm(voiceDir, { recursive: true, force: true })
})

async function addFile(dir: string, path: string): Promise<void> {
  await mkdir(join(dir, path, '..'), { recursive: true })
  await writeFile(join(dir, path), '{}')
}

describe('voice installation on disk', () => {
  it('needs Whisper and at least one speech model', async () => {
    expect(findVoiceInstallation(modelsDir, voiceDir)).toEqual({
      missing: [WHISPER_MODEL_ID, 'pocket-tts/<language>'],
      languages: [],
    })

    await addFile(modelsDir, `${WHISPER_MODEL_ID}/config.json`)
    await addFile(modelsDir, 'pocket-tts/german/bundle.json')

    expect(findVoiceInstallation(modelsDir, voiceDir)).toEqual({
      missing: [],
      languages: [
        { language: 'de', bundleDir: join(modelsDir, 'pocket-tts', 'german'), voicePath: null },
      ],
    })
  })

  it('offers a language with a speech model, and finds its voice by the language name', async () => {
    await addFile(modelsDir, `${WHISPER_MODEL_ID}/config.json`)
    await addFile(modelsDir, 'pocket-tts/german/bundle.json')
    await addFile(modelsDir, 'pocket-tts/english/bundle.json')
    await addFile(voiceDir, 'english.safetensors')
    // A voice without a speech model is not a language.
    await addFile(voiceDir, 'french.safetensors')

    const { languages } = findVoiceInstallation(modelsDir, voiceDir)

    expect(languages.map(({ language, voicePath }) => [language, voicePath])).toEqual([
      ['de', null],
      ['en', join(voiceDir, 'english.safetensors')],
    ])
  })

  it('finds no voices when the voice directory is not set or not absolute', async () => {
    await addFile(modelsDir, 'pocket-tts/english/bundle.json')
    await addFile(voiceDir, 'english.safetensors')

    for (const dir of ['', 'english.safetensors', '.']) {
      expect(findVoiceInstallation(modelsDir, dir).languages[0].voicePath).toBeNull()
    }
  })

  it('refuses to load without models, before touching any model library', async () => {
    await expect(loadVoiceModels({ modelsDir, voiceDir }, () => {})).rejects.toBeInstanceOf(
      VoiceModelsMissingError,
    )
  })

  it('refuses to load when no models directory is configured', async () => {
    await expect(loadVoiceModels({ modelsDir: '', voiceDir }, () => {})).rejects.toBeInstanceOf(
      VoiceModelsMissingError,
    )
  })
})

describe('offline transformers', () => {
  it('turns remote models off and reads only the models directory', () => {
    configureOfflineTransformers(env, modelsDir)

    expect(env.allowRemoteModels).toBe(false)
    expect(env.allowLocalModels).toBe(true)
    expect(env.localModelPath).toBe(modelsDir)
    expect(env.useFSCache).toBe(false)
  })

  it('makes a request for a model that is not on disk throw without any network call', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    configureOfflineTransformers(env, modelsDir)

    await expect(
      pipeline('automatic-speech-recognition', WHISPER_MODEL_ID, { dtype: 'q8' }),
    ).rejects.toThrow(/allowRemoteModels=false|local_files_only/)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
