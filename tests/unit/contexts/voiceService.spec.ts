import { describe, expect, it, vi } from 'vitest'
import {
  VoiceMissingError,
  VoiceModelsMissingError,
  type VoiceEngine,
} from '../../../src/contexts/voice/application/VoiceEngine'
import { VoiceService } from '../../../src/contexts/voice/application/VoiceService'

const LANGUAGES = [
  { language: 'de', voiceInstalled: true },
  { language: 'en', voiceInstalled: false },
] as const

const loads = async () => [...LANGUAGES]

function createEngine(prepare: VoiceEngine['prepare']) {
  let emitUnavailable: (reason: string) => void = () => {}
  const engine: VoiceEngine = {
    id: 'local',
    prepare: vi.fn(prepare),
    transcribe: vi.fn(async () => ({ text: ' text ', language: 'de' as const })),
    speak: async function* () {},
    onUnavailable: listener => {
      emitUnavailable = listener
      return () => {}
    },
    dispose: vi.fn(async () => {}),
  }
  return { engine, emitUnavailable: (reason: string) => emitUnavailable(reason) }
}

describe('VoiceService', () => {
  it('shows a failed load as error, then retries on the next request', async () => {
    const { engine } = createEngine(loads)
    vi.mocked(engine.prepare).mockRejectedValueOnce(new Error('no network'))
    const service = new VoiceService(engine)

    await expect(service.prepare()).rejects.toThrow('no network')
    expect(service.getStatus()).toEqual({ state: 'error', message: 'no network' })

    await expect(service.transcribe(new Float32Array(1))).resolves.toEqual({
      text: 'text',
      language: 'de',
    })
    expect(service.getStatus()).toEqual({ state: 'ready', languages: LANGUAGES })
    expect(engine.prepare).toHaveBeenCalledTimes(2)
  })

  it('says when the server has no models, so the UI can tell voice is not installed', async () => {
    const { engine } = createEngine(async () => {
      throw new VoiceModelsMissingError('no models in /opt/models')
    })
    const service = new VoiceService(engine)

    await expect(service.prepare()).rejects.toBeInstanceOf(VoiceModelsMissingError)
    expect(service.getStatus()).toEqual({
      state: 'error',
      reason: 'models_missing',
      message: 'no models in /opt/models',
    })
  })

  it('goes back to idle when the engine loses its models, and reloads on demand', async () => {
    const { engine, emitUnavailable } = createEngine(loads)
    const service = new VoiceService(engine)
    await service.prepare()

    emitUnavailable('process exited')
    expect(service.getStatus()).toEqual({ state: 'idle' })

    await service.transcribe(new Float32Array(1))
    expect(engine.prepare).toHaveBeenCalledTimes(2)
  })

  it('ignores progress and results from a load the engine abandoned', async () => {
    let finishStale: () => void = () => {}
    let staleProgress: (p: { progress: number }) => void = () => {}
    const { engine, emitUnavailable } = createEngine(
      onProgress =>
        new Promise(resolve => {
          staleProgress = onProgress
          finishStale = () => resolve([...LANGUAGES])
        }),
    )
    const service = new VoiceService(engine)
    const statuses: string[] = []
    service.onStatus(status => statuses.push(status.state))

    const stale = service.prepare()
    emitUnavailable('process exited')
    staleProgress({ progress: 0.9 })
    finishStale()
    await stale

    expect(service.getStatus()).toEqual({ state: 'idle' })
    expect(statuses).toEqual(['loading', 'idle'])
  })

  it('waits for each chunk to be taken before asking the engine for the next', async () => {
    const { engine } = createEngine(loads)
    const asked: number[] = []
    engine.speak = async function* () {
      for (const index of [0, 1]) {
        asked.push(index)
        yield { index, sampleRate: 24000, samples: new Float32Array(1) }
      }
    }
    const service = new VoiceService(engine)
    let releaseFirst!: () => void
    const firstTaken = new Promise<void>(resolve => {
      releaseFirst = resolve
    })

    const speaking = service.speak('A. B.', 'de', new AbortController().signal, chunk =>
      chunk.index === 0 ? firstTaken : undefined,
    )
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(asked).toEqual([0])

    releaseFirst()
    await expect(speaking).resolves.toEqual({ chunkCount: 2, cancelled: false })
    expect(asked).toEqual([0, 1])
  })

  it('refuses to speak a language without a voice before asking the engine', async () => {
    const { engine } = createEngine(loads)
    const speak = vi.fn(engine.speak)
    engine.speak = speak
    const service = new VoiceService(engine)

    await expect(
      service.speak('Hello.', 'en', new AbortController().signal, () => {}),
    ).rejects.toBeInstanceOf(VoiceMissingError)
    expect(speak).not.toHaveBeenCalled()
  })
})
