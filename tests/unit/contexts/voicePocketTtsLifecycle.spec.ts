import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type * as Ort from 'onnxruntime-node'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadPocketTts } from '../../../src/contexts/voice/infrastructure/localEngine/pocketTts/PocketTtsSynthesizer'
import { POCKET_TTS_GRAPHS } from '../../../src/contexts/voice/infrastructure/localEngine/pocketTts/pocketTtsBundle'

/**
 * Loading and cancellation with a fake onnxruntime: no model files needed. Each fake graph file
 * holds its own name, so the fake runtime knows which graph a session is.
 */
const FIXTURES = join(__dirname, '../../fixtures/voice/pocket-tts')

class FakeTensor {
  constructor(
    readonly type: string,
    readonly data: Float32Array | BigInt64Array,
    readonly dims: readonly number[],
  ) {}
}

type Feeds = Record<string, FakeTensor>
type Graph = (typeof POCKET_TTS_GRAPHS)[number]

function fakeOrt(hooks: { failCreate?: Graph; onMimiRun?: () => void } = {}) {
  const released: Graph[] = []
  const f32 = (n: number, dims: number[]) => new FakeTensor('float32', new Float32Array(n), dims)
  const runs: Record<Graph, (feeds: Feeds) => Record<string, FakeTensor>> = {
    'text_conditioner.onnx': feeds => ({
      text_embeddings: f32(feeds.token_ids.dims[1] * 1024, [1, feeds.token_ids.dims[1], 1024]),
    }),
    'flow_lm_main.onnx': feeds => ({
      conditioning: f32(1024, [1, 1024]),
      // Never signals the end, so every chunk runs to its frame limit.
      eos_logit: new FakeTensor('float32', Float32Array.of(-10), [1, 1]),
      kv_out: feeds.kv,
      offset_out: feeds.offset,
    }),
    'flow_lm_flow.onnx': () => ({ flow: f32(32, [1, 32]) }),
    'mimi_decoder.onnx': feeds => {
      hooks.onMimiRun?.()
      const out: Record<string, FakeTensor> = {
        audio: f32(feeds.latent.dims[1] * 1920, [1, 1, feeds.latent.dims[1] * 1920]),
      }
      for (const [name, tensor] of Object.entries(feeds)) {
        if (name.startsWith('state_')) {
          out[`out_${name}`] = tensor
        }
      }
      return out
    },
  }
  const ort = {
    Tensor: FakeTensor,
    InferenceSession: {
      create: async (bytes: Uint8Array) => {
        const graph = new TextDecoder().decode(bytes) as Graph
        await new Promise(resolve => setTimeout(resolve, graph === hooks.failCreate ? 0 : 5))
        if (graph === hooks.failCreate) {
          throw new Error(`cannot create ${graph}`)
        }
        return {
          run: async (feeds: Feeds) => runs[graph](feeds),
          release: async () => {
            released.push(graph)
          },
        }
      },
    },
  }
  return { ort: ort as unknown as typeof Ort, released }
}

const sha256 = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex')

describe('Pocket TTS engine lifecycle', () => {
  let dir: string
  const voice = { kv: new Float32Array(6 * 2 * 4 * 1024), length: 4 }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pocket-tts-'))
    const bundle = JSON.parse(await readFile(join(FIXTURES, 'bundle.german.json'), 'utf8'))
    const tokenizer = await readFile(join(FIXTURES, 'german.tokenizer.json'))
    await writeFile(join(dir, 'tokenizer.json'), tokenizer)
    bundle.files = { 'tokenizer.json': sha256(tokenizer) }
    await Promise.all(
      POCKET_TTS_GRAPHS.map(async graph => {
        bundle.files[graph] = sha256(graph)
        await writeFile(join(dir, graph), graph)
      }),
    )
    await writeFile(join(dir, 'bundle.json'), JSON.stringify(bundle))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('releases the sessions it created when another one fails to load', async () => {
    const { ort, released } = fakeOrt({ failCreate: 'mimi_decoder.onnx' })
    await expect(loadPocketTts(dir, ort)).rejects.toThrow('cannot create mimi_decoder.onnx')
    expect(released.sort()).toEqual(
      POCKET_TTS_GRAPHS.filter(graph => graph !== 'mimi_decoder.onnx').sort(),
    )
  })

  it('releases the sessions when a graph does not match its checksum', async () => {
    await writeFile(join(dir, 'flow_lm_flow.onnx'), 'tampered')
    const { ort, released } = fakeOrt()
    await expect(loadPocketTts(dir, ort)).rejects.toThrow('does not match its checksum')
    expect(released.sort()).toEqual(
      POCKET_TTS_GRAPHS.filter(graph => graph !== 'flow_lm_flow.onnx').sort(),
    )
  })

  it('streams audio until aborted, and nothing decoded after the abort', async () => {
    const plain = await loadPocketTts(dir, fakeOrt().ort)
    let all = 0
    for await (const _audio of plain.synthesize('Der Bild ist jetzt fertig.', voice)) {
      all += 1
    }
    expect(all).toBeGreaterThan(2)

    const controller = new AbortController()
    let mimiRuns = 0
    const { ort } = fakeOrt({
      onMimiRun: () => {
        mimiRuns += 1
        if (mimiRuns === 2) {
          controller.abort()
        }
      },
    })
    const tts = await loadPocketTts(dir, ort)
    const yielded: Float32Array[] = []
    for await (const audio of tts.synthesize('Der Bild ist jetzt fertig.', voice, {
      signal: controller.signal,
    })) {
      yielded.push(audio)
    }
    // The first batch came out; the second was decoded while aborting and is dropped.
    expect(mimiRuns).toBe(2)
    expect(yielded).toHaveLength(1)
  })

  it('drops the last, partial batch when aborted while it decodes', async () => {
    const controller = new AbortController()
    let mimiRuns = 0
    let lastRun = 0
    const counting = fakeOrt({ onMimiRun: () => (lastRun += 1) })
    const plain = await loadPocketTts(dir, counting.ort)
    for await (const _audio of plain.synthesize('Der Bild ist jetzt fertig.', voice)) {
      // Count the decodes of a full run.
    }
    const { ort } = fakeOrt({
      onMimiRun: () => {
        mimiRuns += 1
        if (mimiRuns === lastRun) {
          controller.abort()
        }
      },
    })
    const tts = await loadPocketTts(dir, ort)
    let yielded = 0
    for await (const _audio of tts.synthesize('Der Bild ist jetzt fertig.', voice, {
      signal: controller.signal,
    })) {
      yielded += 1
    }
    expect(yielded).toBe(lastRun - 1)
  })
})
