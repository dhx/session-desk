import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  preparePocketTtsPrompt,
  splitPocketTtsChunks,
  type PocketTtsTextOptions,
} from '../../../src/contexts/voice/infrastructure/localEngine/pocketTts/pocketTtsText'
import { createUnigramTokenizer } from '../../../src/contexts/voice/infrastructure/localEngine/pocketTts/unigramTokenizer'

// Written by scripts/voice/pocket-tts/make_text_fixtures.py from the pocket-tts reference.
const FIXTURES = join(__dirname, '../../fixtures/voice/pocket-tts')

interface TextFixture {
  options: PocketTtsTextOptions
  cases: {
    input: string
    ids: number[]
    decoded: string
    prepared: string
    framesAfterEosGuess: number
    chunks50: string[]
    chunks12: string[]
  }[]
}

function load(language: string) {
  const read = (name: string) => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'))
  return {
    tokenizer: createUnigramTokenizer(read(`${language}.tokenizer.json`)),
    fixture: read(`${language}.text.json`) as TextFixture,
  }
}

describe.each(['german', 'english'])('Pocket TTS text for %s matches the reference', language => {
  const { tokenizer, fixture } = load(language)

  it.each(fixture.cases.map(c => [c.input, c] as const))('tokenizes %j', (_input, c) => {
    expect(tokenizer.encode(c.input)).toEqual(c.ids)
    expect(tokenizer.decode(c.ids)).toBe(c.decoded)
  })

  it.each(fixture.cases.map(c => [c.input, c] as const))('prepares and chunks %j', (_input, c) => {
    expect(preparePocketTtsPrompt(c.input, fixture.options)).toEqual({
      text: c.prepared,
      framesAfterEosGuess: c.framesAfterEosGuess,
    })
    expect(splitPocketTtsChunks(tokenizer, c.input, 50, fixture.options)).toEqual(c.chunks50)
    expect(splitPocketTtsChunks(tokenizer, c.input, 12, fixture.options)).toEqual(c.chunks12)
  })
})

describe('createUnigramTokenizer', () => {
  it('refuses a configuration it does not mirror', () => {
    const json = JSON.parse(readFileSync(join(FIXTURES, 'german.tokenizer.json'), 'utf8'))
    json.model.byte_fallback = false
    expect(() => createUnigramTokenizer(json)).toThrow('Unsupported Pocket TTS tokenizer')
  })
})
