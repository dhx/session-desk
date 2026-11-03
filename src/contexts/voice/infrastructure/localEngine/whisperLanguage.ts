/**
 * Language detection for multilingual Whisper inside the one decoding pass. transformers.js 3.8
 * cannot detect the language (without one it assumes English), so decoding starts from
 * `<|startoftranscript|>` alone and this processor steers the next three tokens: the language,
 * chosen by the model but only among the ones voice supports, then `<|transcribe|>` and
 * `<|notimestamps|>`. The language costs nothing extra; the prompt Whisper expects is unchanged.
 */
import { VOICE_LANGUAGES, type VoiceLanguage } from '../../../../shared/contracts/dto'

export interface WhisperPromptTokens {
  startOfTranscript: number
  languages: Record<VoiceLanguage, number>
  transcribe: number
  noTimestamps: number
  /** Not allowed as the first text token (a bare space, end of text). */
  beginSuppress: readonly number[]
}

/** Reads the token ids from Whisper's `generation_config.json`. */
export function readWhisperPromptTokens(config: {
  decoder_start_token_id?: unknown
  lang_to_id?: unknown
  task_to_id?: unknown
  no_timestamps_token_id?: unknown
  begin_suppress_tokens?: unknown
}): WhisperPromptTokens {
  const langToId = (config.lang_to_id ?? {}) as Record<string, unknown>
  const taskToId = (config.task_to_id ?? {}) as Record<string, unknown>
  const id = (value: unknown, name: string): number => {
    if (!Number.isInteger(value)) {
      throw new Error(`Whisper generation config has no ${name}; is this a multilingual model?`)
    }
    return value as number
  }
  const languages = Object.fromEntries(
    VOICE_LANGUAGES.map(language => [language, id(langToId[`<|${language}|>`], `<|${language}|>`)]),
  ) as Record<VoiceLanguage, number>
  const beginSuppress = Array.isArray(config.begin_suppress_tokens)
    ? config.begin_suppress_tokens.filter((value): value is number => Number.isInteger(value))
    : []
  return {
    startOfTranscript: id(config.decoder_start_token_id, 'decoder_start_token_id'),
    languages,
    transcribe: id(taskToId.transcribe, 'transcribe task'),
    noTimestamps: id(config.no_timestamps_token_id, 'no_timestamps_token_id'),
    beginSuppress,
  }
}

function keepOnly(row: Float32Array, keep: readonly number[], value?: number): void {
  const kept = keep.map(token => row[token])
  row.fill(Number.NEGATIVE_INFINITY)
  keep.forEach((token, index) => {
    row[token] = value ?? kept[index]
  })
}

/**
 * Edits the logits for the next token, given how many tokens the sequence already has. Step 1
 * (after `<|startoftranscript|>`) keeps the supported languages' own scores, so the model picks
 * between them; steps 2 and 3 force the task and no timestamps (the model's generation config
 * suppresses `<|transcribe|>` otherwise); step 4 keeps text from starting blank or empty.
 */
export function steerWhisperPrompt(
  sequenceLength: number,
  row: Float32Array,
  tokens: WhisperPromptTokens,
): void {
  switch (sequenceLength) {
    case 1:
      keepOnly(row, Object.values(tokens.languages))
      return
    case 2:
      keepOnly(row, [tokens.transcribe], 0)
      return
    case 3:
      keepOnly(row, [tokens.noTimestamps], 0)
      return
    case 4:
      for (const token of tokens.beginSuppress) {
        row[token] = Number.NEGATIVE_INFINITY
      }
      return
    default:
  }
}

/** The language token at position 1 of a decoded sequence, or null when it is not one of ours. */
export function readWhisperLanguage(
  sequence: readonly (number | bigint)[],
  tokens: WhisperPromptTokens,
): VoiceLanguage | null {
  const token = Number(sequence[1])
  return VOICE_LANGUAGES.find(language => tokens.languages[language] === token) ?? null
}
