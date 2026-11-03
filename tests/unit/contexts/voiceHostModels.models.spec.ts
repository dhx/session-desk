import { describe, expect, it } from 'vitest'
import { loadVoiceModels } from '../../../src/contexts/voice/infrastructure/localEngine/voiceHostModels'

/**
 * The real models end to end: speak a sentence, then hear it back. Needs the models (Whisper
 * `onnx-community/whisper-base` and Pocket TTS bundles under `pocket-tts/<german|english>/`), so
 * it runs only when VOICE_TEST_MODELS_DIR names such a folder and VOICE_TEST_VOICE_DIR one with
 * `german.safetensors` and `english.safetensors` (the open catalog voice does).
 */
const modelsDir = process.env.VOICE_TEST_MODELS_DIR
const voiceDir = process.env.VOICE_TEST_VOICE_DIR

/** 24 kHz speech to the 16 kHz Whisper hears, by linear interpolation; enough for a test. */
function to16k(samples: Float32Array, rate: number): Float32Array {
  const out = new Float32Array(Math.floor((samples.length * 16_000) / rate))
  for (let i = 0; i < out.length; i += 1) {
    const at = (i * rate) / 16_000
    const left = Math.floor(at)
    const right = Math.min(left + 1, samples.length - 1)
    out[i] = samples[left] + (samples[right] - samples[left]) * (at - left)
  }
  return out
}

describe.skipIf(!modelsDir || !voiceDir)('voice models, spoken and heard back', () => {
  // Speech is sampled (temperature 0.3), so a word may come out differently from run to run; the
  // language must not.
  it.each([
    // Not "Der Bild ist jetzt fertig.": spoken, it is close enough to "the build" that Whisper
    // takes a sentence that short for English.
    ['de', 'Ich habe die Tests repariert und alles ist grün.', /alles ist/i],
    ['en', 'The build is done.', /is done/i],
  ] as const)(
    'speaks %s and Whisper hears it in that language',
    async (language, sentence, expected) => {
      const models = await loadVoiceModels({ modelsDir: modelsDir!, voiceDir: voiceDir! }, () => {})
      expect(models.languages).toEqual([
        { language: 'de', voiceInstalled: true },
        { language: 'en', voiceInstalled: true },
      ])

      const pieces: Float32Array[] = []
      let rate = 0
      for await (const audio of models.synthesize(
        sentence,
        language,
        new AbortController().signal,
      )) {
        pieces.push(audio.samples)
        rate = audio.sampleRate
      }
      const speech = new Float32Array(pieces.reduce((sum, piece) => sum + piece.length, 0))
      pieces.reduce((offset, piece) => {
        speech.set(piece, offset)
        return offset + piece.length
      }, 0)

      const heard = await models.transcribe(to16k(speech, rate))

      expect(heard.language).toBe(language)
      expect(heard.text).toMatch(expected)
    },
    180_000,
  )
})
