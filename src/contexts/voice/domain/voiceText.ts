/** Appended to every voice prompt so the boss hands back a short line meant to be heard. */
export const VOICE_REPLY_INSTRUCTION =
  '(Voice request: end your reply with a line starting "SAY:" holding a 1-3 sentence spoken summary.)'

const FALLBACK_SENTENCE_COUNT = 3

// Abbreviations whose trailing period does not end a sentence.
const ABBREVIATIONS = new Set(['e.g.', 'i.e.', 'etc.', 'vs.', 'mr.', 'mrs.', 'ms.', 'dr.', 'st.'])

/**
 * Builds the text typed into the boss terminal. It stays on one line: a newline inside an agent
 * TUI prompt can submit early or open a multi-line editor, depending on the agent.
 */
export function buildVoicePrompt(transcript: string): string {
  return `${transcript.trim()} ${VOICE_REPLY_INSTRUCTION}`
}

export function splitIntoSentences(text: string): string[] {
  const sentences: string[] = []
  for (const line of text.split(/\n+/)) {
    let current = ''
    for (const word of line.split(/\s+/).filter(Boolean)) {
      current = current ? `${current} ${word}` : word
      if (/[.!?]["')\]]*$/.test(word) && !ABBREVIATIONS.has(word.toLowerCase())) {
        sentences.push(current)
        current = ''
      }
    }
    if (current) {
      sentences.push(current)
    }
  }
  return sentences
}

/** The SAY: line when the boss wrote one, otherwise the first sentences of the reply. */
export function pickSpokenText(reply: string): string | null {
  const sayLine = findLastSayLine(reply)
  if (sayLine !== null) {
    return sayLine
  }

  const sentences = splitIntoSentences(stripMarkdown(reply)).slice(0, FALLBACK_SENTENCE_COUNT)
  return sentences.length > 0 ? sentences.join(' ') : null
}

function findLastSayLine(reply: string): string | null {
  const lines = reply.split('\n')
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    // Tolerates markdown decoration such as "**SAY:** ..." or "> SAY: ...".
    const match = /^[\s>*_-]*SAY:[*_]*\s*(.*)$/i.exec(lines[index])
    const spoken = match?.[1].replace(/[*_]+$/, '').trim()
    if (spoken) {
      return spoken
    }
  }
  return null
}

function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, '\n')
    .replace(/^\s*#{1,6}\s.*$/gm, '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*(?:[-*+]|\d+\.|>)\s+/gm, '')
    .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, '$1')
}
