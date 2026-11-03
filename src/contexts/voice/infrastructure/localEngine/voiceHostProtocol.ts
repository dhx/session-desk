/** Messages between the worker and the voice host child process. */

import {
  VOICE_LANGUAGES,
  type VoiceLanguage,
  type VoiceLanguageAvailability,
} from '../../../../shared/contracts/dto'

/** Multilingual, so it hears German too; it also tells which language it heard. */
export const WHISPER_MODEL_ID = 'onnx-community/whisper-base'
export const WHISPER_DTYPE = 'q8'

export type VoiceHostRequest =
  /** `voiceDir`: the installation's voices (`<language name>.safetensors`); may be empty. */
  | { type: 'prepare'; id: string; modelsDir: string; voiceDir: string }
  | { type: 'transcribe'; id: string; pcm16k: Float32Array }
  | { type: 'speak'; id: string; text: string; language: VoiceLanguage }
  | { type: 'cancel'; id: string }

export type VoiceHostReply =
  | { type: 'progress'; id: string; progress: number }
  | { type: 'chunk'; id: string; index: number; sampleRate: number; samples: Float32Array }
  /** `prepare` answers with `languages`; `transcribe` with `text` and `language`. */
  | {
      type: 'done'
      id: string
      text?: string
      language?: VoiceLanguage
      languages?: VoiceLanguageAvailability[]
    }
  /** `code` marks failures a caller treats differently from a plain error. */
  | { type: 'error'; id: string; message: string; code?: VoiceHostErrorCode }

export type VoiceHostErrorCode = 'models_missing' | 'voice_missing'

const ERROR_CODES: readonly string[] = ['models_missing', 'voice_missing']

export function isVoiceLanguage(value: unknown): value is VoiceLanguage {
  return VOICE_LANGUAGES.includes(value as VoiceLanguage)
}

function isLanguageList(value: unknown): value is VoiceLanguageAvailability[] {
  return (
    Array.isArray(value) &&
    value.every(
      entry =>
        isRecord(entry) &&
        isVoiceLanguage(entry.language) &&
        typeof entry.voiceInstalled === 'boolean',
    )
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object'
}

export function isVoiceHostRequest(value: unknown): value is VoiceHostRequest {
  if (!isRecord(value) || typeof value.id !== 'string') {
    return false
  }
  switch (value.type) {
    case 'prepare':
      return typeof value.modelsDir === 'string' && typeof value.voiceDir === 'string'
    case 'transcribe':
      return value.pcm16k instanceof Float32Array
    case 'speak':
      return typeof value.text === 'string' && isVoiceLanguage(value.language)
    case 'cancel':
      return true
    default:
      return false
  }
}

export function isVoiceHostReply(value: unknown): value is VoiceHostReply {
  if (!isRecord(value) || typeof value.id !== 'string') {
    return false
  }
  switch (value.type) {
    case 'progress':
      return true
    case 'chunk':
      return value.samples instanceof Float32Array && typeof value.sampleRate === 'number'
    case 'done':
      return (
        (value.text === undefined || typeof value.text === 'string') &&
        (value.language === undefined || isVoiceLanguage(value.language)) &&
        (value.languages === undefined || isLanguageList(value.languages))
      )
    case 'error':
      return (
        typeof value.message === 'string' &&
        (value.code === undefined || ERROR_CODES.includes(value.code as string))
      )
    default:
      return false
  }
}
