/**
 * Turning text into the chunks Pocket TTS generates one at a time. A line-by-line port of
 * `pocket_tts/models/text_chunking.py` (pocket-tts 4.0.1); the fixtures in the tests come from it.
 * The model is trained on single sentences, so long inputs are split on sentence boundaries and
 * regrouped into chunks that fit `maxTokens`.
 */
import type { UnigramTokenizer } from './unigramTokenizer'

export interface PocketTtsTextOptions {
  padWithSpacesForShortInputs: boolean
  removeSemicolons: boolean
  appendTerminalPunctuation: boolean
  capitalizeFirstLetter: boolean
  replaceCharacters: Record<string, string>
}

export interface PreparedPrompt {
  text: string
  /** Frames to keep generating after the model signals the end, before `+ 2` for safety. */
  framesAfterEosGuess: number
}

const TERMINAL_PUNCTUATION = '.!?…'
const WEAK_PUNCTUATION = ',;:-–—'
const CLOSERS = '"\'”’)]»'

function words(text: string): string[] {
  return text.split(/\s+/u).filter(Boolean)
}

function rstripChars(text: string, chars: string): string {
  let end = text.length
  while (end > 0 && chars.includes(text[end - 1])) {
    end -= 1
  }
  return text.slice(0, end)
}

function isUpper(char: string): boolean {
  return char !== char.toLowerCase() && char === char.toUpperCase()
}

function ensureTerminalPunctuation(text: string): string {
  const core = rstripChars(text, `${CLOSERS} `)
  const closers = text.slice(core.length).trim()
  if (!core || TERMINAL_PUNCTUATION.includes(core[core.length - 1])) {
    return text
  }
  if (WEAK_PUNCTUATION.includes(core[core.length - 1])) {
    return `${rstripChars(core, `${WEAK_PUNCTUATION} `)}.${closers}`
  }
  return `${text}.`
}

export function preparePocketTtsPrompt(raw: string, options: PocketTtsTextOptions): PreparedPrompt {
  let text = raw.trim()
  const replacements = Object.entries(options.replaceCharacters)
  if (replacements.length > 0) {
    const map = new Map(replacements)
    text = words(Array.from(text, char => map.get(char) ?? char).join('')).join(' ')
    // Deleted quotes leave '"Hi?", she said' as 'Hi?, she said'; keep the sentence mark only.
    text = text.replace(/([.!?…])\s*[,;:]/gu, '$1')
  }
  if (text === '') {
    throw new Error('Text prompt cannot be empty')
  }
  text = text.replaceAll('\n', ' ').replaceAll('\r', ' ').replaceAll('  ', ' ')
  if (options.removeSemicolons) {
    text = text.replaceAll(';', ',')
  }
  const framesAfterEosGuess = words(text).length <= 4 ? 3 : 1
  if (options.capitalizeFirstLetter && !isUpper(text[0])) {
    const first = Array.from(text)[0]
    text = first.toUpperCase() + text.slice(first.length)
  }
  if (options.appendTerminalPunctuation) {
    text = ensureTerminalPunctuation(text)
  }
  if (options.padWithSpacesForShortInputs && words(text).length < 5) {
    text = ' '.repeat(8) + text
  }
  return { text, framesAfterEosGuess }
}

function isDigit(char: string | undefined): boolean {
  return char !== undefined && /^\p{Nd}$/u.test(char)
}

function isDecimalPeriodBoundary(
  tokens: readonly number[],
  start: number,
  tokenizer: UnigramTokenizer,
): boolean {
  const prefix = tokenizer.decode(tokens.slice(0, start))
  const suffix = tokenizer.decode(tokens.slice(start))
  return (
    prefix.length >= 2 &&
    prefix[prefix.length - 1] === '.' &&
    isDigit(prefix[prefix.length - 2]) &&
    suffix.length > 0 &&
    isDigit(suffix[0])
  )
}

function findBoundaryIndices(
  tokens: readonly number[],
  boundaryTokens: readonly number[],
  tokenizer?: UnigramTokenizer,
): number[] {
  const boundary = new Set(boundaryTokens)
  const indices = [0]
  let previousWasBoundary = false
  tokens.forEach((token, index) => {
    if (boundary.has(token)) {
      previousWasBoundary = true
      return
    }
    if (previousWasBoundary) {
      if (!tokenizer || !isDecimalPeriodBoundary(tokens, index, tokenizer)) {
        indices.push(index)
      }
    }
    previousWasBoundary = false
  })
  indices.push(tokens.length)
  return indices
}

function segmentsFromBoundaries(
  tokens: readonly number[],
  boundaries: readonly number[],
  tokenizer: UnigramTokenizer,
): { count: number; text: string }[] {
  const segments: { count: number; text: string }[] = []
  for (let i = 0; i < boundaries.length - 1; i += 1) {
    const [start, end] = [boundaries[i], boundaries[i + 1]]
    segments.push({ count: end - start, text: tokenizer.decode(tokens.slice(start, end)) })
  }
  return segments
}

export function splitPocketTtsChunks(
  tokenizer: UnigramTokenizer,
  raw: string,
  maxTokens: number,
  options: PocketTtsTextOptions,
): string[] {
  const text = preparePocketTtsPrompt(raw, options).text.trim()
  const tokens = tokenizer.encode(text)

  const sentenceEnds = tokenizer.encode('.!...?').slice(1)
  const sentences = segmentsFromBoundaries(
    tokens,
    findBoundaryIndices(tokens, sentenceEnds, tokenizer),
    tokenizer,
  )

  // Sub-split oversized sentences on commas, semicolons and colons so no words are skipped.
  const fallback = tokenizer.encode(',;:').slice(1)
  const refined: { count: number; text: string }[] = []
  for (const sentence of sentences) {
    if (sentence.count <= maxTokens) {
      refined.push(sentence)
      continue
    }
    const subTokens = tokenizer.encode(sentence.text.trim())
    const sub = segmentsFromBoundaries(
      subTokens,
      findBoundaryIndices(subTokens, fallback),
      tokenizer,
    )
    refined.push(...(sub.length > 1 ? sub : [sentence]))
  }

  const chunks: string[] = []
  let current = ''
  let currentCount = 0
  for (const { count, text: sentence } of refined) {
    if (current === '') {
      current = sentence
      currentCount = count
      continue
    }
    if (currentCount + count > maxTokens) {
      chunks.push(current.trim())
      current = sentence
      currentCount = count
    } else {
      current += ` ${sentence}`
      currentCount += count
    }
  }
  if (current !== '') {
    chunks.push(current.trim())
  }
  return chunks
}
