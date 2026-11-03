import { describe, expect, it, vi } from 'vitest'
import {
  createVoiceHostHandler,
  FIRST_CHUNK_SECONDS,
  type VoiceModels,
} from '../../../src/contexts/voice/infrastructure/localEngine/voiceHostHandler'
import type { VoiceHostReply } from '../../../src/contexts/voice/infrastructure/localEngine/voiceHostProtocol'
import {
  VoiceMissingError,
  VoiceModelsMissingError,
} from '../../../src/contexts/voice/application/VoiceEngine'

const RATE = 24_000
const LANGUAGES = [
  { language: 'de', voiceInstalled: true },
  { language: 'en', voiceInstalled: false },
] as const

/** Audio of `seconds`, its first sample marking which piece it was. */
function piece(seconds: number, mark: number): Float32Array {
  const samples = new Float32Array(Math.round(seconds * RATE))
  samples[0] = mark
  return samples
}

/**
 * Speaks each request as pieces of the given lengths, like Pocket TTS does. `gate`, when set, is
 * awaited after each piece, so a test can act between them.
 */
function createModels(pieceSeconds: number[] = [0.2, 0.2, 0.2, 0.64]) {
  const calls: { text: string; language: string; signal: AbortSignal }[] = []
  let gate: (() => Promise<void>) | null = null
  const models: VoiceModels = {
    languages: [...LANGUAGES],
    transcribe: vi.fn(async (pcm16k: Float32Array) => ({
      text: `heard ${pcm16k.length}`,
      language: 'de' as const,
    })),
    synthesize: vi.fn(async function* (text, language, signal) {
      calls.push({ text, language, signal })
      for (const [index, seconds] of pieceSeconds.entries()) {
        yield { samples: piece(seconds, (index + 1) / 10), sampleRate: RATE }
        // eslint-disable-next-line no-await-in-loop -- The test steps through the pieces.
        await gate?.()
      }
    }),
  }
  return {
    models,
    calls,
    setGate: (next: () => Promise<void>) => {
      gate = next
    },
  }
}

function setup(loadModels = vi.fn(async () => createModels().models)) {
  const replies: VoiceHostReply[] = []
  const handle = createVoiceHostHandler({ loadModels, send: reply => replies.push(reply) })
  return { handle, replies, loadModels }
}

const PREPARE = {
  type: 'prepare',
  id: 'p1',
  modelsDir: '/opt/models',
  voiceDir: '/voices',
} as const
const chunks = (replies: VoiceHostReply[]) =>
  replies.flatMap(reply => (reply.type === 'chunk' ? [reply] : []))

describe('voice host handler', () => {
  it('loads models once, reports progress to the requester and answers the languages', async () => {
    const loadModels = vi.fn(async (_dirs: unknown, onProgress: (progress: number) => void) => {
      onProgress(0.25)
      return createModels().models
    })
    const { handle, replies } = setup(loadModels)

    await handle(PREPARE)
    await handle({ ...PREPARE, id: 'p2' })

    expect(loadModels).toHaveBeenCalledTimes(1)
    expect(loadModels).toHaveBeenCalledWith(
      { modelsDir: '/opt/models', voiceDir: '/voices' },
      expect.any(Function),
    )
    expect(replies).toEqual([
      { type: 'progress', id: 'p1', progress: 0.25 },
      { type: 'done', id: 'p1', languages: LANGUAGES },
      { type: 'done', id: 'p2', languages: LANGUAGES },
    ])
  })

  it('retries loading after a failed load', async () => {
    const loadModels = vi
      .fn()
      .mockRejectedValueOnce(new Error('download failed'))
      .mockResolvedValueOnce(createModels().models)
    const { handle, replies } = setup(loadModels)

    await handle(PREPARE)
    await handle({ ...PREPARE, id: 'p2' })

    expect(replies).toEqual([
      { type: 'error', id: 'p1', message: 'download failed' },
      { type: 'done', id: 'p2', languages: LANGUAGES },
    ])
  })

  it('refuses work before models are loaded', async () => {
    const { handle, replies } = setup()
    await handle({ type: 'transcribe', id: 't1', pcm16k: new Float32Array(4) })
    expect(replies).toEqual([{ type: 'error', id: 't1', message: 'voice models are not loaded' }])
  })

  it('answers the transcript with the language it was heard in', async () => {
    const { handle, replies } = setup()
    await handle(PREPARE)
    replies.length = 0

    await handle({ type: 'transcribe', id: 't1', pcm16k: new Float32Array(8) })

    expect(replies).toEqual([{ type: 'done', id: 't1', text: 'heard 8', language: 'de' }])
  })

  it('holds the first pieces back until half a second is ready, then streams in order', async () => {
    const fake = createModels([0.2, 0.2, 0.2, 0.64])
    const { handle, replies } = setup(vi.fn(async () => fake.models))
    await handle(PREPARE)
    replies.length = 0

    await handle({ type: 'speak', id: 's1', text: 'Guten Abend.', language: 'de' })

    expect(fake.calls.map(({ text, language }) => [text, language])).toEqual([
      ['Guten Abend.', 'de'],
    ])
    const sent = chunks(replies)
    expect(sent.map(chunk => [chunk.index, chunk.samples.length / RATE])).toEqual([
      [0, 0.6],
      [1, 0.64],
    ])
    expect(sent[0].samples.length / RATE).toBeGreaterThanOrEqual(FIRST_CHUNK_SECONDS)
    // The first chunk joins the first three pieces in order.
    const first = sent[0].samples
    expect([first[0], first[0.2 * RATE], first[0.4 * RATE]]).toEqual(
      Array.from(Float32Array.of(0.1, 0.2, 0.3)),
    )
    expect(replies.at(-1)).toEqual({ type: 'done', id: 's1' })
  })

  it('sends a reply shorter than half a second as one chunk', async () => {
    const fake = createModels([0.16, 0.16])
    const { handle, replies } = setup(vi.fn(async () => fake.models))
    await handle(PREPARE)
    replies.length = 0

    await handle({ type: 'speak', id: 's1', text: 'Ja.', language: 'de' })

    expect(chunks(replies).map(chunk => chunk.samples.length)).toEqual([0.32 * RATE])
    expect(replies.at(-1)).toEqual({ type: 'done', id: 's1' })
  })

  it('aborts generation on cancel and sends nothing after it', async () => {
    const fake = createModels([0.6, 0.6, 0.6])
    let release: () => void = () => {}
    let waiting = false
    fake.setGate(
      () =>
        new Promise<void>(resolve => {
          waiting = true
          release = resolve
        }),
    )
    const { handle, replies } = setup(vi.fn(async () => fake.models))
    await handle(PREPARE)
    replies.length = 0

    const speaking = handle({ type: 'speak', id: 's1', text: 'Eins. Zwei.', language: 'de' })
    await vi.waitFor(() => expect(waiting).toBe(true))
    void handle({ type: 'cancel', id: 's1' })
    expect(fake.calls[0].signal.aborted).toBe(true)
    release()
    await speaking

    expect(replies.map(reply => reply.type)).toEqual(['chunk', 'done'])
  })

  it('cancels a speak request that is still queued', async () => {
    const fake = createModels()
    const { handle, replies } = setup(vi.fn(async () => fake.models))
    void handle(PREPARE)
    const speaking = handle({ type: 'speak', id: 's1', text: 'Never said.', language: 'en' })
    void handle({ type: 'cancel', id: 's1' })
    await speaking

    expect(chunks(replies)).toEqual([])
    expect(replies.at(-1)).toEqual({ type: 'done', id: 's1' })
  })

  it('fails a speak request instead of sending NaN audio', async () => {
    const fake = createModels()
    vi.mocked(fake.models.synthesize).mockImplementationOnce(async function* () {
      yield { samples: new Float32Array([0.1, Number.NaN]), sampleRate: RATE }
    })
    const { handle, replies } = setup(vi.fn(async () => fake.models))
    await handle(PREPARE)
    replies.length = 0

    await handle({ type: 'speak', id: 's1', text: 'Broken.', language: 'en' })

    expect(replies).toEqual([
      { type: 'error', id: 's1', message: 'speech synthesis produced invalid audio' },
    ])
  })

  it('ignores malformed messages', async () => {
    const { handle, replies } = setup()
    await handle({ type: 'speak', id: 's1', text: 'Hi.', language: 'fr' })
    await handle({ type: 'speak', id: 's1', text: 'Hi.', voice: 'bm_george' })
    await handle('garbage')
    expect(replies).toEqual([])
  })

  it('marks a missing-models failure with its code', async () => {
    const sent: VoiceHostReply[] = []
    const handle = createVoiceHostHandler({
      loadModels: async () => {
        throw new VoiceModelsMissingError('no models in /opt/models')
      },
      send: reply => sent.push(reply),
    })

    await handle(PREPARE)

    expect(sent).toEqual([
      { type: 'error', id: 'p1', code: 'models_missing', message: 'no models in /opt/models' },
    ])
  })

  it('marks a missing voice with its code', async () => {
    const fake = createModels()
    vi.mocked(fake.models.synthesize).mockImplementationOnce(async function* () {
      yield* []
      throw new VoiceMissingError('No voice is installed for en.')
    })
    const { handle, replies } = setup(vi.fn(async () => fake.models))
    await handle(PREPARE)
    replies.length = 0

    await handle({ type: 'speak', id: 's1', text: 'Hello.', language: 'en' })

    expect(replies).toEqual([
      { type: 'error', id: 's1', code: 'voice_missing', message: 'No voice is installed for en.' },
    ])
  })
})
