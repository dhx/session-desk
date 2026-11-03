import type { VoiceLanguage, VoiceLanguageAvailability } from '../../../../shared/contracts/dto'
import {
  VoiceMissingError,
  VoiceModelsMissingError,
  type VoiceTranscription,
} from '../../application/VoiceEngine'
import { isVoiceHostRequest, type VoiceHostReply, type VoiceHostRequest } from './voiceHostProtocol'

export interface SynthesizedAudio {
  samples: Float32Array
  sampleRate: number
}

export interface VoiceModels {
  languages: VoiceLanguageAvailability[]
  transcribe(pcm16k: Float32Array): Promise<VoiceTranscription>
  /** Yields audio in order as it is generated; stops soon after `signal` aborts. */
  synthesize(
    text: string,
    language: VoiceLanguage,
    signal: AbortSignal,
  ): AsyncIterable<SynthesizedAudio>
}

export type VoiceModelLoader = (
  dirs: { modelsDir: string; voiceDir: string },
  onProgress: (progress: number) => void,
) => Promise<VoiceModels>

/**
 * Audio held back before the first chunk of a reply goes out. Generation runs ahead of playback,
 * but its first pieces are short: sent at once, the player would run dry before the next one.
 */
export const FIRST_CHUNK_SECONDS = 0.5

function join(pieces: SynthesizedAudio[]): SynthesizedAudio {
  if (pieces.length === 1) {
    return pieces[0]
  }
  const samples = new Float32Array(pieces.reduce((sum, piece) => sum + piece.samples.length, 0))
  let offset = 0
  for (const piece of pieces) {
    samples.set(piece.samples, offset)
    offset += piece.samples.length
  }
  return { samples, sampleRate: pieces[0].sampleRate }
}

/**
 * Runs requests one at a time so speech and transcription never compete for the CPU.
 * `cancel` bypasses the queue: it aborts a queued or running speak request, which then stops
 * within a few frames and sends nothing more.
 */
export function createVoiceHostHandler(options: {
  loadModels: VoiceModelLoader
  send: (reply: VoiceHostReply) => void
}): (message: unknown) => Promise<void> {
  let models: Promise<VoiceModels> | null = null
  let queue: Promise<void> = Promise.resolve()
  const speaking = new Map<string, AbortController>()

  const handle = async (request: Exclude<VoiceHostRequest, { type: 'cancel' }>): Promise<void> => {
    const { id } = request
    try {
      if (request.type === 'prepare') {
        if (!models) {
          models = options.loadModels(
            { modelsDir: request.modelsDir, voiceDir: request.voiceDir },
            progress => options.send({ type: 'progress', id, progress }),
          )
          models.catch(() => {
            models = null
          })
        }
        options.send({ type: 'done', id, languages: (await models).languages })
        return
      }

      if (!models) {
        throw new Error('voice models are not loaded')
      }
      const loaded = await models

      if (request.type === 'transcribe') {
        options.send({ type: 'done', id, ...(await loaded.transcribe(request.pcm16k)) })
        return
      }

      const signal = speaking.get(id)?.signal ?? AbortSignal.abort()
      let index = 0
      let held: SynthesizedAudio[] = []
      let heldSamples = 0
      const send = (audio: SynthesizedAudio): void => {
        // A broken model can emit NaN samples, which play as silence and poison Whisper input.
        if (!audio.samples.every(Number.isFinite)) {
          throw new Error('speech synthesis produced invalid audio')
        }
        options.send({ type: 'chunk', id, index, ...audio })
        index += 1
      }
      for await (const audio of loaded.synthesize(request.text, request.language, signal)) {
        if (signal.aborted) {
          break
        }
        if (index > 0) {
          send(audio)
          continue
        }
        held.push(audio)
        heldSamples += audio.samples.length
        if (heldSamples >= FIRST_CHUNK_SECONDS * audio.sampleRate) {
          send(join(held))
          held = []
        }
      }
      if (held.length > 0 && !signal.aborted) {
        send(join(held))
      }
      options.send({ type: 'done', id })
    } catch (error) {
      options.send({
        type: 'error',
        id,
        ...(error instanceof VoiceModelsMissingError ? { code: 'models_missing' as const } : {}),
        ...(error instanceof VoiceMissingError ? { code: 'voice_missing' as const } : {}),
        message: error instanceof Error ? error.message : String(error),
      })
    } finally {
      speaking.delete(id)
    }
  }

  return message => {
    if (!isVoiceHostRequest(message)) {
      return queue
    }
    if (message.type === 'cancel') {
      speaking.get(message.id)?.abort()
      return queue
    }
    if (message.type === 'speak') {
      speaking.set(message.id, new AbortController())
    }
    queue = queue.then(() => handle(message))
    return queue
  }
}
