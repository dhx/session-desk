import type { VoiceLanguage, VoiceLanguageAvailability } from '../../../shared/contracts/dto'
import type { VoiceEngineId } from '../domain/voiceSettings'

export interface VoiceModelProgress {
  /** 0..1 across every model file being loaded. */
  progress: number
}

export interface VoiceAudioChunk {
  index: number
  sampleRate: number
  samples: Float32Array
}

export interface VoiceTranscription {
  text: string
  language: VoiceLanguage
}

/** Speech in and speech out. The local engine and a later OpenAI Realtime engine both fit it. */
export interface VoiceEngine {
  readonly id: VoiceEngineId
  /**
   * Loads the models and says which languages can be spoken. Safe to call again after the engine
   * reported it became unavailable.
   */
  prepare(onProgress: (progress: VoiceModelProgress) => void): Promise<VoiceLanguageAvailability[]>
  transcribe(pcm16k: Float32Array): Promise<VoiceTranscription>
  /** Yields audio in order as it is generated. Aborting stops generation within a few frames. */
  speak(text: string, language: VoiceLanguage, signal: AbortSignal): AsyncIterable<VoiceAudioChunk>
  /** Fires when loaded models are lost, for example when the engine process exits. */
  onUnavailable(listener: (reason: string) => void): () => void
  dispose(): Promise<void>
}

/** No voice is installed for the language a reply should be spoken in. Retrying will not help. */
export class VoiceMissingError extends Error {
  public override readonly name = 'VoiceMissingError'
}

/** The engine has no models to load. Not a transient failure: retrying will not help. */
export class VoiceModelsMissingError extends Error {
  public override readonly name = 'VoiceModelsMissingError'
}
