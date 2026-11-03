import { describe, expect, it, vi } from 'vitest'
import {
  LocalVoiceEngine,
  VOICE_HOST_IDLE_UNLOAD_MS,
} from '../../../src/contexts/voice/infrastructure/localEngine/LocalVoiceEngine'
import {
  VoiceMissingError,
  VoiceModelsMissingError,
} from '../../../src/contexts/voice/application/VoiceEngine'
import type {
  VoiceHostReply,
  VoiceHostRequest,
} from '../../../src/contexts/voice/infrastructure/localEngine/voiceHostProtocol'
import type { PtyHostProcess } from '../../../src/platform/process/ptyHost/processTypes'

function createFakeProcess() {
  const listeners: { message?: (m: unknown) => void; exit?: (code: number) => void } = {}
  const posted: VoiceHostRequest[] = []
  const process: PtyHostProcess = {
    on: ((event: 'message' | 'exit' | 'error', listener: (value: never) => void) => {
      if (event === 'message') {
        listeners.message = listener as (m: unknown) => void
      }
      if (event === 'exit') {
        listeners.exit = listener as (code: number) => void
      }
    }) as PtyHostProcess['on'],
    postMessage: (message, callback) => {
      posted.push(message as VoiceHostRequest)
      callback?.(null)
    },
    kill: vi.fn(() => true),
    stdout: null,
    stderr: null,
    pid: 1,
  }
  return {
    process,
    posted,
    reply: (reply: VoiceHostReply) => listeners.message?.(reply),
    exit: (code: number) => listeners.exit?.(code),
  }
}

function setup() {
  const processes: ReturnType<typeof createFakeProcess>[] = []
  let nextId = 0
  const reportIssue = vi.fn()
  const engine = new LocalVoiceEngine({
    modelsDir: 'C:/userData/models',
    voiceDir: '/srv/voices',
    createProcess: () => {
      const fake = createFakeProcess()
      processes.push(fake)
      return fake.process
    },
    reportIssue,
    createId: () => `r${++nextId}`,
  })
  return { engine, processes, reportIssue }
}

async function prepare(setupResult: ReturnType<typeof setup>): Promise<void> {
  const preparing = setupResult.engine.prepare(() => {})
  setupResult.processes
    .at(-1)
    ?.reply({ type: 'done', id: setupResult.processes.at(-1)!.posted.at(-1)!.id })
  await preparing
}

describe('LocalVoiceEngine', () => {
  it('forks the host lazily, sends both directories and answers the languages', async () => {
    const ctx = setup()
    expect(ctx.processes).toHaveLength(0)

    const progress = vi.fn()
    const preparing = ctx.engine.prepare(progress)
    const [host] = ctx.processes
    expect(host.posted).toEqual([
      { type: 'prepare', id: 'r1', modelsDir: 'C:/userData/models', voiceDir: '/srv/voices' },
    ])

    host.reply({ type: 'progress', id: 'r1', progress: 0.5 })
    host.reply({ type: 'done', id: 'r1', languages: [{ language: 'de', voiceInstalled: true }] })
    await expect(preparing).resolves.toEqual([{ language: 'de', voiceInstalled: true }])
    expect(progress).toHaveBeenCalledWith({ progress: 0.5 })
  })

  it('resolves transcribe with the host text and rejects on host error', async () => {
    const ctx = setup()
    await prepare(ctx)
    const host = ctx.processes[0]

    const ok = ctx.engine.transcribe(new Float32Array(2))
    host.reply({ type: 'done', id: 'r2', text: 'hallo', language: 'de' })
    await expect(ok).resolves.toEqual({ text: 'hallo', language: 'de' })

    const failed = ctx.engine.transcribe(new Float32Array(2))
    host.reply({ type: 'error', id: 'r3', message: 'boom' })
    await expect(failed).rejects.toThrow('boom')
  })

  it('streams speak chunks until done', async () => {
    const ctx = setup()
    await prepare(ctx)
    const host = ctx.processes[0]
    const controller = new AbortController()

    const received: number[] = []
    const consuming = (async () => {
      for await (const chunk of ctx.engine.speak('One. Two.', 'en', controller.signal)) {
        received.push(chunk.index)
      }
    })()
    host.reply({
      type: 'chunk',
      id: 'r2',
      index: 0,
      sampleRate: 24_000,
      samples: new Float32Array(1),
    })
    host.reply({
      type: 'chunk',
      id: 'r2',
      index: 1,
      sampleRate: 24_000,
      samples: new Float32Array(1),
    })
    host.reply({ type: 'done', id: 'r2' })
    await consuming

    expect(received).toEqual([0, 1])
    expect(host.posted.at(-1)).toEqual({
      type: 'speak',
      id: 'r2',
      text: 'One. Two.',
      language: 'en',
    })
  })

  it('sends cancel to the host when the signal aborts', async () => {
    const ctx = setup()
    await prepare(ctx)
    const host = ctx.processes[0]
    const controller = new AbortController()

    const consuming = (async () => {
      const received: number[] = []
      for await (const chunk of ctx.engine.speak('One. Two.', 'en', controller.signal)) {
        received.push(chunk.index)
        controller.abort()
      }
      return received
    })()
    host.reply({
      type: 'chunk',
      id: 'r2',
      index: 0,
      sampleRate: 24_000,
      samples: new Float32Array(1),
    })

    await expect(consuming).resolves.toEqual([0])
    expect(host.posted.at(-1)).toEqual({ type: 'cancel', id: 'r2' })
  })

  it('fails pending requests when the host exits, then forks a new host', async () => {
    const ctx = setup()
    await prepare(ctx)
    const unavailable = vi.fn()
    ctx.engine.onUnavailable(unavailable)

    const pending = ctx.engine.transcribe(new Float32Array(2))
    ctx.processes[0].exit(3)

    await expect(pending).rejects.toThrow('voice engine process exited with code 3')
    expect(unavailable).toHaveBeenCalledWith('voice engine process exited with code 3')

    void ctx.engine.prepare(() => {})
    expect(ctx.processes).toHaveLength(2)
    expect(ctx.processes[1].posted[0]).toMatchObject({ type: 'prepare' })
  })

  it('does not report loss when the host dies before models loaded', async () => {
    const ctx = setup()
    const unavailable = vi.fn()
    ctx.engine.onUnavailable(unavailable)

    const preparing = ctx.engine.prepare(() => {})
    ctx.processes[0].exit(1)

    await expect(preparing).rejects.toThrow('exited with code 1')
    expect(unavailable).not.toHaveBeenCalled()
  })

  it('does not fork a new host just to cancel speech on a host that exited', async () => {
    const ctx = setup()
    const controller = new AbortController()
    const speech = ctx.engine.speak('Hi.', 'en', controller.signal)
    const next = speech[Symbol.asyncIterator]().next()

    ctx.processes[0].exit(0)
    controller.abort()

    await expect(next).rejects.toThrow('exited')
    expect(ctx.processes).toHaveLength(1)
  })

  it('rejects everything after dispose and kills the host', async () => {
    const ctx = setup()
    await prepare(ctx)
    const pending = ctx.engine.transcribe(new Float32Array(1))

    await ctx.engine.dispose()

    await expect(pending).rejects.toThrow('disposed')
    await expect(ctx.engine.transcribe(new Float32Array(1))).rejects.toThrow('disposed')
    expect(ctx.processes[0].process.kill).toHaveBeenCalled()
  })

  it('unloads the host after it was idle, without reporting an issue', async () => {
    vi.useFakeTimers()
    try {
      const ctx = setup()
      await prepare(ctx)
      const unavailable = vi.fn()
      ctx.engine.onUnavailable(unavailable)

      vi.advanceTimersByTime(VOICE_HOST_IDLE_UNLOAD_MS - 1)
      expect(ctx.processes[0].process.kill).not.toHaveBeenCalled()

      vi.advanceTimersByTime(1)
      expect(ctx.processes[0].process.kill).toHaveBeenCalled()
      expect(unavailable).toHaveBeenCalledWith('voice engine unloaded after being idle')
      expect(ctx.reportIssue).not.toHaveBeenCalled()

      // The killed process exiting afterwards is not a second loss.
      ctx.processes[0].exit(0)
      expect(unavailable).toHaveBeenCalledTimes(1)

      void ctx.engine.prepare(() => {})
      expect(ctx.processes).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not unload while a request is in flight, and counts idle time from its end', async () => {
    vi.useFakeTimers()
    try {
      const ctx = setup()
      await prepare(ctx)
      vi.advanceTimersByTime(VOICE_HOST_IDLE_UNLOAD_MS - 10)
      const pending = ctx.engine.transcribe(new Float32Array(1))

      vi.advanceTimersByTime(VOICE_HOST_IDLE_UNLOAD_MS * 2)
      expect(ctx.processes[0].process.kill).not.toHaveBeenCalled()

      ctx.processes[0].reply({ type: 'done', id: 'r2', text: 'hi', language: 'en' })
      await expect(pending).resolves.toEqual({ text: 'hi', language: 'en' })
      vi.advanceTimersByTime(VOICE_HOST_IDLE_UNLOAD_MS - 1)
      expect(ctx.processes[0].process.kill).not.toHaveBeenCalled()
      vi.advanceTimersByTime(1)
      expect(ctx.processes[0].process.kill).toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects prepare with VoiceModelsMissingError when the host has no models', async () => {
    const ctx = setup()
    const preparing = ctx.engine.prepare(() => {})
    ctx.processes[0].reply({
      type: 'error',
      id: 'r1',
      code: 'models_missing',
      message: 'no models in /opt/models',
    })

    await expect(preparing).rejects.toBeInstanceOf(VoiceModelsMissingError)
  })

  it('fails speech with VoiceMissingError when the host has no voice for the language', async () => {
    const ctx = setup()
    await prepare(ctx)
    const speech = ctx.engine.speak('Hallo.', 'de', new AbortController().signal)
    const next = speech[Symbol.asyncIterator]().next()
    const [host] = ctx.processes

    host.reply({ type: 'error', id: 'r2', code: 'voice_missing', message: 'No voice for de.' })

    await expect(next).rejects.toBeInstanceOf(VoiceMissingError)
  })
})
