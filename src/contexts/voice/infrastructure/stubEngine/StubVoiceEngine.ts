import type { VoiceLanguage, VoiceLanguageAvailability } from '../../../../shared/contracts/dto'
import type {
  VoiceAudioChunk,
  VoiceEngine,
  VoiceModelProgress,
  VoiceTranscription,
} from '../../application/VoiceEngine'
import { splitIntoSentences } from '../../domain/voiceText'

const STUB_SAMPLE_RATE = 24000

/**
 * A voice engine without models, for end-to-end tests (`OPENCOVE_TEST_VOICE_ENGINE=stub`). It
 * answers every recording with a fixed transcript and speaks each sentence as a short tone, so the
 * whole path from button to speaker runs without Whisper or Pocket TTS.
 */
export class StubVoiceEngine implements VoiceEngine {
  public readonly id = 'local' as const
  private readonly transcript: string
  private readonly language: VoiceLanguage

  public constructor(options: { transcript?: string; language?: VoiceLanguage } = {}) {
    this.transcript = options.transcript ?? 'stub transcript'
    this.language = options.language ?? 'en'
  }

  public async prepare(
    onProgress: (progress: VoiceModelProgress) => void,
  ): Promise<VoiceLanguageAvailability[]> {
    onProgress({ progress: 1 })
    return [
      { language: 'de', voiceInstalled: true },
      { language: 'en', voiceInstalled: true },
    ]
  }

  public async transcribe(_pcm16k: Float32Array): Promise<VoiceTranscription> {
    return { text: this.transcript, language: this.language }
  }

  public async *speak(
    text: string,
    _language: VoiceLanguage,
    signal: AbortSignal,
  ): AsyncGenerator<VoiceAudioChunk> {
    let index = 0
    for (const sentence of splitIntoSentences(text)) {
      if (signal.aborted) {
        return
      }
      yield { index, sampleRate: STUB_SAMPLE_RATE, samples: createTone(sentence.length) }
      index += 1
    }
  }

  public onUnavailable(): () => void {
    return () => {}
  }

  public async dispose(): Promise<void> {}
}

/** A quiet 440 Hz tone, 20 ms per character, so longer sentences play longer. */
function createTone(characters: number): Float32Array {
  const samples = new Float32Array(Math.max(1, characters) * (STUB_SAMPLE_RATE / 50))
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = 0.1 * Math.sin((2 * Math.PI * 440 * index) / STUB_SAMPLE_RATE)
  }
  return samples
}
