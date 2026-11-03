import { describe, expect, it } from 'vitest'
import {
  readWhisperLanguage,
  readWhisperPromptTokens,
  steerWhisperPrompt,
} from '../../../src/contexts/voice/infrastructure/localEngine/whisperLanguage'

/** The ids of `onnx-community/whisper-base`'s generation_config.json. */
const CONFIG = {
  decoder_start_token_id: 50258,
  lang_to_id: { '<|en|>': 50259, '<|zh|>': 50260, '<|de|>': 50261 },
  task_to_id: { transcribe: 50359, translate: 50358 },
  no_timestamps_token_id: 50363,
  begin_suppress_tokens: [220, 50257],
}
const TOKENS = readWhisperPromptTokens(CONFIG)

function logits(values: Record<number, number> = {}): Float32Array {
  const row = new Float32Array(50400).fill(1)
  for (const [token, value] of Object.entries(values)) {
    row[Number(token)] = value
  }
  return row
}

function allowed(row: Float32Array): number[] {
  return [...row.keys()].filter(token => row[token] !== Number.NEGATIVE_INFINITY)
}

describe('Whisper prompt steering', () => {
  it('reads the prompt tokens of a multilingual model', () => {
    expect(TOKENS).toEqual({
      startOfTranscript: 50258,
      languages: { de: 50261, en: 50259 },
      transcribe: 50359,
      noTimestamps: 50363,
      beginSuppress: [220, 50257],
    })
  })

  it('refuses an English-only model, which has no language tokens', () => {
    expect(() => readWhisperPromptTokens({ ...CONFIG, lang_to_id: undefined })).toThrow(
      /multilingual/,
    )
  })

  it('lets the model choose only between German and English, by its own scores', () => {
    // Chinese scores highest, but voice does not speak it.
    const row = logits({ 50259: 3, 50260: 9, 50261: 5 })

    steerWhisperPrompt(1, row, TOKENS)

    expect(allowed(row)).toEqual([50259, 50261])
    expect([row[50259], row[50261]]).toEqual([3, 5])
  })

  it('then forces the transcribe task, even though the model suppresses it, and no timestamps', () => {
    const task = logits({ 50359: Number.NEGATIVE_INFINITY })
    steerWhisperPrompt(2, task, TOKENS)
    expect(allowed(task)).toEqual([50359])

    const timestamps = logits()
    steerWhisperPrompt(3, timestamps, TOKENS)
    expect(allowed(timestamps)).toEqual([50363])
  })

  it('keeps the text from starting with a bare space or ending at once, then leaves it alone', () => {
    const first = logits()
    steerWhisperPrompt(4, first, TOKENS)
    expect([first[220], first[50257], first[1000]]).toEqual([
      Number.NEGATIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      1,
    ])

    const later = logits()
    steerWhisperPrompt(9, later, TOKENS)
    expect(allowed(later)).toHaveLength(later.length)
  })

  it('reads the language from the decoded sequence', () => {
    expect(readWhisperLanguage([50258n, 50261n, 50359n, 50363n, 1000n], TOKENS)).toBe('de')
    expect(readWhisperLanguage([50258, 50259, 50359], TOKENS)).toBe('en')
    expect(readWhisperLanguage([50258, 50260], TOKENS)).toBeNull()
  })
})
