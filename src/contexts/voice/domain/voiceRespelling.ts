/**
 * Respellings: words the speech model of a language says wrongly, written the way it says them
 * right. The German model reads English developer words by German rules ("Merge" as "Merge"), so
 * they are written as a German speaker would say them. Applied only to the text that is spoken;
 * what is shown stays as written.
 */
import type { VoiceLanguage } from '../../../shared/contracts/dto'

/** Written → spoken. Keys are matched as whole words or phrases, ignoring case. */
export type VoiceLexicon = Readonly<Record<string, string>>

/**
 * Chosen by ear with the German model, carrier sentence "Der … ist jetzt fertig."
 * "Pull Request", "Branch" and "Review" it says well as written.
 */
export const BUILT_IN_RESPELLINGS: Readonly<Record<VoiceLanguage, VoiceLexicon>> = {
  de: {
    build: 'Bild',
    merge: 'Mördsch',
    commit: 'Kommitt',
    deploy: 'Diploi',
    push: 'Pusch',
  },
  en: {},
}

/** Limits on an installation's own lexicon, so a broken file cannot slow every reply down. */
export const MAX_LEXICON_ENTRIES = 1000
const MAX_LEXICON_TEXT = 100

/**
 * Checks an installation's lexicon (`lexicon.<language>.json`): an object of non-empty strings,
 * written → spoken. Returns the reason it is not one, or null.
 */
export function findLexiconProblem(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return 'it must be a JSON object of "written": "spoken" pairs'
  }
  const entries = Object.entries(value)
  if (entries.length > MAX_LEXICON_ENTRIES) {
    return `it has ${entries.length} entries; at most ${MAX_LEXICON_ENTRIES} are allowed`
  }
  for (const [written, spoken] of entries) {
    if (
      written.trim().length === 0 ||
      written.length > MAX_LEXICON_TEXT ||
      typeof spoken !== 'string' ||
      spoken.trim().length === 0 ||
      spoken.length > MAX_LEXICON_TEXT
    ) {
      return `the entry ${JSON.stringify(written)} is not a pair of non-empty texts up to ${MAX_LEXICON_TEXT} characters`
    }
  }
  return null
}

const WORD_CHAR = String.raw`[\p{L}\p{N}_]`

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** "Merge" → "Mördsch", "merge" → "mördsch": the spoken form takes the case of the first letter. */
function matchCase(written: string, spoken: string): string {
  const first = written.charAt(0)
  const spokenFirst = spoken.charAt(0)
  if (first === first.toUpperCase() && first !== first.toLowerCase()) {
    return spokenFirst.toUpperCase() + spoken.slice(1)
  }
  if (first === first.toLowerCase() && first !== first.toUpperCase()) {
    return spokenFirst.toLowerCase() + spoken.slice(1)
  }
  return spoken
}

export interface VoiceRespeller {
  (text: string): string
}

/**
 * Builds the respeller for a language: the built-in list, with the installation's lexicon on top
 * (it wins for the same word). Longer phrases are tried first, so "Pull Request" can have its own
 * spelling apart from "Pull".
 */
export function createVoiceRespeller(
  language: VoiceLanguage,
  lexicon: VoiceLexicon = {},
): VoiceRespeller {
  const spellings = new Map<string, string>()
  for (const [written, spoken] of Object.entries(BUILT_IN_RESPELLINGS[language])) {
    spellings.set(written.toLowerCase(), spoken)
  }
  for (const [written, spoken] of Object.entries(lexicon)) {
    spellings.set(written.trim().toLowerCase().replace(/\s+/g, ' '), spoken.trim())
  }
  if (spellings.size === 0) {
    return text => text
  }
  const phrases = [...spellings.keys()].sort((a, b) => b.length - a.length)
  const pattern = new RegExp(
    `(?<!${WORD_CHAR})(?:${phrases
      .map(phrase =>
        phrase
          .split(' ')
          .map(escapeRegExp)
          .join(String.raw`\s+`),
      )
      .join('|')})(?!${WORD_CHAR})`,
    'giu',
  )
  return text =>
    text.replace(pattern, written => {
      const spoken = spellings.get(written.toLowerCase().replace(/\s+/g, ' '))
      return spoken === undefined ? written : matchCase(written, spoken)
    })
}
