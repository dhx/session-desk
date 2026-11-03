import { readFile } from 'node:fs/promises'
import { findLexiconProblem, type VoiceLexicon } from '../../domain/voiceRespelling'

/** A lexicon file is a few kilobytes; anything far larger is not one. */
const MAX_LEXICON_BYTES = 256 * 1024

/**
 * Reads an installation's lexicon (`$OPENCOVE_VOICE_DIR/lexicon.<language name>.json`). A missing
 * file is no lexicon. A broken one is reported and ignored: a typo in it must not stop replies.
 */
export async function readVoiceLexicon(
  path: string | null,
  report: (message: string) => void,
): Promise<VoiceLexicon> {
  if (!path) {
    return {}
  }
  let text: string
  try {
    const bytes = await readFile(path)
    if (bytes.byteLength > MAX_LEXICON_BYTES) {
      report(`voice lexicon ${path} ignored: larger than ${MAX_LEXICON_BYTES / 1024} KB`)
      return {}
    }
    text = bytes.toString('utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      report(`voice lexicon ${path} ignored: ${(error as Error).message}`)
    }
    return {}
  }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    report(`voice lexicon ${path} ignored: it is not valid JSON`)
    return {}
  }
  const problem = findLexiconProblem(value)
  if (problem) {
    report(`voice lexicon ${path} ignored: ${problem}`)
    return {}
  }
  return value as VoiceLexicon
}
