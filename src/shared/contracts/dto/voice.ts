/** The languages voice understands and speaks. */
export const VOICE_LANGUAGES = ['de', 'en'] as const
export type VoiceLanguage = (typeof VOICE_LANGUAGES)[number]

/** What this server can speak in one language. */
export interface VoiceLanguageAvailability {
  language: VoiceLanguage
  /** A voice is installed for it (`OPENCOVE_VOICE_DIR`); without one, replies cannot be spoken. */
  voiceInstalled: boolean
}

/** Model loading state of the voice engine, owned by the worker. */
export type VoiceEngineStatus =
  | { state: 'idle' }
  /** progress is 0..1 across loading the local model files, or null until a file reports bytes. */
  | { state: 'loading'; progress: number | null }
  /** `languages`: the languages this server has a speech model for. */
  | { state: 'ready'; languages: VoiceLanguageAvailability[] }
  /** `models_missing`: this server has no voice models, so voice is not installed here. */
  | { state: 'error'; message: string; reason?: 'models_missing' }

export interface VoiceTranscribeInput {
  /** Mono PCM at 16 kHz, samples in -1..1. */
  pcm16k: Float32Array
}

export interface VoiceTranscribeResult {
  text: string
  /** The language the speech was heard in. */
  language: VoiceLanguage
}

export interface VoiceSpeakInput {
  /** Chosen by the caller so it can match chunk events and cancel. */
  requestId: string
  text: string
  language: VoiceLanguage
}

export interface VoiceSpeakResult {
  chunkCount: number
  cancelled: boolean
}

export interface VoiceCancelSpeakInput {
  requestId: string
}

/** One sentence of speech for the request that asked for it, in order. */
export interface VoiceSpeakChunkEvent {
  requestId: string
  index: number
  sampleRate: number
  samples: Float32Array
}
