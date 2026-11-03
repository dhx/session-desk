import { describe, expect, it } from 'vitest'
import {
  VOICE_REPLY_INSTRUCTION,
  buildVoicePrompt,
  pickSpokenText,
  splitIntoSentences,
} from '../../../src/contexts/voice/domain/voiceText'

describe('buildVoicePrompt', () => {
  it('appends the SAY instruction on the same line', () => {
    const prompt = buildVoicePrompt('  list the agents ')
    expect(prompt).toBe(`list the agents ${VOICE_REPLY_INSTRUCTION}`)
    expect(prompt).not.toContain('\n')
  })
})

describe('splitIntoSentences', () => {
  it('splits on sentence punctuation and keeps it', () => {
    expect(splitIntoSentences('Good evening. All four agents are online! Shall I deploy?')).toEqual(
      ['Good evening.', 'All four agents are online!', 'Shall I deploy?'],
    )
  })

  it('does not split decimals, versions, or common abbreviations', () => {
    expect(splitIntoSentences('Node 22.12 is fine, e.g. for builds. Done.')).toEqual([
      'Node 22.12 is fine, e.g. for builds.',
      'Done.',
    ])
  })

  it('treats line breaks as boundaries and keeps unterminated text', () => {
    expect(splitIntoSentences('First line\n\nSecond line. Third')).toEqual([
      'First line',
      'Second line.',
      'Third',
    ])
  })

  it('keeps closing quotes and brackets with their sentence', () => {
    expect(splitIntoSentences('He said "done." Then (it shipped.) End')).toEqual([
      'He said "done."',
      'Then (it shipped.)',
      'End',
    ])
  })

  it('returns nothing for blank text', () => {
    expect(splitIntoSentences('  \n ')).toEqual([])
  })
})

describe('pickSpokenText', () => {
  it('speaks only the SAY line when present', () => {
    const reply = 'I listed 4 agents.\n\n| id | status |\n\nSAY: Four agents are running, all idle.'
    expect(pickSpokenText(reply)).toBe('Four agents are running, all idle.')
  })

  it('accepts markdown-decorated and lowercase SAY lines', () => {
    expect(pickSpokenText('Done.\n**SAY:** The build passed.')).toBe('The build passed.')
    expect(pickSpokenText('Done.\n> say: All good.')).toBe('All good.')
  })

  it('uses the last SAY line when there are several', () => {
    expect(pickSpokenText('SAY: draft\nmore work\nSAY: final answer')).toBe('final answer')
  })

  it('ignores an empty SAY line and falls back to the first three sentences', () => {
    const reply = '# Result\nOne. Two. Three. Four.\nSAY:'
    expect(pickSpokenText(reply)).toBe('One. Two. Three.')
  })

  it('drops code blocks and markdown markers in the fallback', () => {
    const reply = '- Ran `pnpm test`.\n```sh\nrm -rf out\n```\n**All** tests passed.'
    expect(pickSpokenText(reply)).toBe('Ran pnpm test. All tests passed.')
  })

  it('returns null when there is nothing to say', () => {
    expect(pickSpokenText('```\ncode only\n```')).toBeNull()
  })
})
