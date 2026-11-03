import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as ort from 'onnxruntime-node'
import { describe, expect, it } from 'vitest'
import { loadPocketTts } from '../../../src/contexts/voice/infrastructure/localEngine/pocketTts/PocketTtsSynthesizer'

/**
 * Compares the TypeScript engine against scripts/voice/pocket-tts/reference.py on the same int8
 * bundle. Needs the exported bundles (about 125 MB per language), so it runs only when
 * POCKET_TTS_BUNDLES names a folder with german/ and english/ bundles and POCKET_TTS_VOICES a
 * folder with the open catalog voice at <language>/alba.safetensors.
 */
const bundles = process.env.POCKET_TTS_BUNDLES
const voices = process.env.POCKET_TTS_VOICES
const FIXTURES = join(__dirname, '../../fixtures/voice/pocket-tts')

interface ReferenceFixture {
  bundle: Record<string, string>
  cases: { sentence: string; ids: number[]; latents: number[][] }[]
}

describe.skipIf(!bundles || !voices).each(['german', 'english'])(
  'Pocket TTS engine for %s matches the reference run',
  language => {
    const fixture = JSON.parse(
      readFileSync(join(FIXTURES, `${language}.reference.json`), 'utf8'),
    ) as ReferenceFixture

    it('generates the reference latents at temperature 0 and streams finite audio', async () => {
      const tts = await loadPocketTts(join(bundles!, language), ort)
      try {
        expect(tts.bundle.files).toEqual(fixture.bundle)
        const voice = await tts.loadVoice(join(voices!, language, 'alba.safetensors'))
        for (const c of fixture.cases) {
          const latents: Float32Array[] = []
          let samples = 0
          // eslint-disable-next-line no-await-in-loop -- One sentence after the other.
          for await (const audio of tts.synthesize(c.sentence, voice, {
            temperature: 0,
            onLatent: latent => latents.push(latent),
          })) {
            expect(audio.every(Number.isFinite)).toBe(true)
            samples += audio.length
          }
          expect(latents).toHaveLength(c.latents.length)
          latents.forEach((latent, frame) => {
            const diff = Math.max(...latent.map((v, i) => Math.abs(v - c.latents[frame][i])))
            expect(diff, `${c.sentence} frame ${frame}`).toBeLessThan(1e-3)
          })
          expect(samples).toBe(c.latents.length * tts.bundle.samplesPerFrame)
        }
      } finally {
        await tts.release()
      }
    }, 120_000)
  },
)
