import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readVoiceLexicon } from '../../../src/contexts/voice/infrastructure/localEngine/voiceLexiconFile'

let dir: string
let reports: string[]
const report = (message: string): void => {
  reports.push(message)
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'voice-lexicon-'))
  reports = []
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('voice lexicon file', () => {
  it('reads the pairs of a valid file', async () => {
    const path = join(dir, 'lexicon.german.json')
    await writeFile(path, JSON.stringify({ Kubernetes: 'Kuberneetis' }))

    await expect(readVoiceLexicon(path, report)).resolves.toEqual({ Kubernetes: 'Kuberneetis' })
    expect(reports).toEqual([])
  })

  it('is empty, without a report, when there is no file or no voice directory', async () => {
    await expect(readVoiceLexicon(join(dir, 'lexicon.german.json'), report)).resolves.toEqual({})
    await expect(readVoiceLexicon(null, report)).resolves.toEqual({})
    expect(reports).toEqual([])
  })

  it('ignores a broken file and says why, so replies still work', async () => {
    const cases: [string, RegExp][] = [
      ['{"build": "Bild",}', /not valid JSON/],
      ['["build", "Bild"]', /JSON object/],
      [`{"x": "${'y'.repeat(300 * 1024)}"}`, /larger than 256 KB/],
    ]
    for (const [content, reason] of cases) {
      const path = join(dir, 'lexicon.german.json')
      // eslint-disable-next-line no-await-in-loop -- One file after the other, same path.
      await writeFile(path, content)
      reports = []

      // eslint-disable-next-line no-await-in-loop -- Reads the file just written.
      await expect(readVoiceLexicon(path, report)).resolves.toEqual({})
      expect(reports).toEqual([expect.stringMatching(reason)])
    }
  })

  it('reports a path it cannot read for another reason than absence', async () => {
    await expect(readVoiceLexicon(dir, report)).resolves.toEqual({})
    expect(reports).toEqual([expect.stringContaining('ignored')])
  })
})
