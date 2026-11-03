import { describe, expect, it } from 'vitest'
import {
  createVoiceRespeller,
  findLexiconProblem,
  MAX_LEXICON_ENTRIES,
} from '../../../src/contexts/voice/domain/voiceRespelling'

describe('German respellings', () => {
  const respell = createVoiceRespeller('de')

  it('respells the developer words the German model says wrongly', () => {
    expect(respell('Der Build ist fertig. Soll ich mergen? Merge, Commit, Deploy, Push.')).toBe(
      'Der Bild ist fertig. Soll ich mergen? Mördsch, Kommitt, Diploi, Pusch.',
    )
  })

  it('matches whole words only, ignoring case, and keeps the case of the first letter', () => {
    expect(respell('build BUILD Build builds Rebuild pushover')).toBe(
      'bild Bild Bild builds Rebuild pushover',
    )
  })

  it('treats hyphens and punctuation as word boundaries', () => {
    expect(respell('Der Merge-Konflikt (Push!) ist gelöst.')).toBe(
      'Der Mördsch-Konflikt (Pusch!) ist gelöst.',
    )
  })

  it('leaves the words it says well as written', () => {
    expect(respell('Der Pull Request für den Branch ist im Review.')).toBe(
      'Der Pull Request für den Branch ist im Review.',
    )
  })
})

describe('English respellings', () => {
  it('has none built in', () => {
    expect(createVoiceRespeller('en')('The build is done; merge and push.')).toBe(
      'The build is done; merge and push.',
    )
  })
})

describe("an installation's lexicon", () => {
  it('adds words and wins over the built-in spelling of the same word', () => {
    const respell = createVoiceRespeller('de', { Kubernetes: 'Kuberneetis', build: 'Bilt' })

    expect(respell('Build für Kubernetes')).toBe('Bilt für Kuberneetis')
  })

  it('respells phrases, trying the longest first, across any whitespace', () => {
    const respell = createVoiceRespeller('de', {
      'Pull Request': 'Pull Rikwest',
      pull: 'Pull',
    })

    expect(respell('Der Pull   Request und der pull.')).toBe('Der Pull Rikwest und der pull.')
  })

  it('takes letters outside ASCII as part of a word', () => {
    const respell = createVoiceRespeller('de', { grün: 'gruen' })

    expect(respell('Grün und grünlich')).toBe('Gruen und grünlich')
  })

  it('takes regular expression characters in a word literally', () => {
    const respell = createVoiceRespeller('en', { 'C++': 'C plus plus', 'a.b': 'a dot b' })

    expect(respell('C++ and a.b, not axb')).toBe('C plus plus and a dot b, not axb')
  })
})

describe('lexicon check', () => {
  it('accepts an object of non-empty texts', () => {
    expect(findLexiconProblem({ Kubernetes: 'Kuberneetis' })).toBeNull()
    expect(findLexiconProblem({})).toBeNull()
  })

  it('names what is wrong with anything else', () => {
    expect(findLexiconProblem([])).toMatch(/JSON object/)
    expect(findLexiconProblem('build=Bild')).toMatch(/JSON object/)
    expect(findLexiconProblem({ build: 3 })).toMatch(/"build"/)
    expect(findLexiconProblem({ ' ': 'x' })).toMatch(/not a pair/)
    expect(findLexiconProblem({ build: '' })).toMatch(/not a pair/)
    expect(findLexiconProblem({ build: 'x'.repeat(101) })).toMatch(/up to 100/)
    const tooMany = Object.fromEntries(
      Array.from({ length: MAX_LEXICON_ENTRIES + 1 }, (_, i) => [`w${i}`, 'x']),
    )
    expect(findLexiconProblem(tooMany)).toMatch(/at most 1000/)
  })
})
