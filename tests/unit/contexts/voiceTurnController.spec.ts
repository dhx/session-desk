import { describe, expect, it, vi } from 'vitest'
import {
  createVoiceTurnController,
  type VoiceTurnPorts,
} from '../../../src/contexts/voice/application/voiceTurnController'
import { MIN_VOICE_HOLD_MS } from '../../../src/contexts/voice/domain/voiceTurn'
import { voiceReplyInstruction } from '../../../src/contexts/voice/domain/voiceText'

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(next => {
    resolve = next
  })
  return { promise, resolve }
}

function setup(overrides: Partial<VoiceTurnPorts> = {}) {
  let clock = 0
  let nextId = 0
  const replies: Array<ReturnType<typeof deferred<string | null>>> = []
  const askSignals: AbortSignal[] = []
  const speakSignals: AbortSignal[] = []
  const ports: VoiceTurnPorts = {
    startRecording: vi.fn(async () => {}),
    stopRecording: vi.fn(async () => new Float32Array(16)),
    cancelRecording: vi.fn(),
    transcribe: vi.fn(async () => ({ text: 'list the agents', language: 'en' as const })),
    replyLanguage: vi.fn(heard => heard),
    askBoss: vi.fn((_prompt: string, signal: AbortSignal, onSent: () => void) => {
      askSignals.push(signal)
      onSent()
      const reply = deferred<string | null>()
      replies.push(reply)
      return reply.promise
    }),
    speak: vi.fn(async (_text: string, _language: string, signal: AbortSignal) => {
      speakSignals.push(signal)
      await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve()))
    }),
    hasBoss: () => true,
    shouldSpeakReplies: () => true,
    createTurnId: () => `t${(nextId += 1)}`,
    now: () => clock,
    ...overrides,
  }
  const controller = createVoiceTurnController(ports)
  const phases: string[] = []
  controller.subscribe(state => phases.push(state.phase))
  const hold = async (ms = MIN_VOICE_HOLD_MS + 200): Promise<void> => {
    controller.press()
    clock += ms
    controller.release()
    await flush()
  }
  return { controller, ports, phases, replies, askSignals, speakSignals, hold }
}

const flush = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

describe('createVoiceTurnController', () => {
  it('asks the boss for the spoken line in the reply language and speaks it in that language', async () => {
    // Heard English, but the settings fix German: the boss must write the SAY line in German,
    // or the German speech model would read English.
    const replyLanguage = vi.fn(() => 'de' as const)
    const { ports, replies, hold } = setup({ replyLanguage, speak: vi.fn(async () => {}) })
    await hold()

    expect(replyLanguage).toHaveBeenCalledWith('en')
    expect(ports.askBoss).toHaveBeenCalledWith(
      `list the agents ${voiceReplyInstruction('de')}`,
      expect.any(AbortSignal),
      expect.any(Function),
    )
    replies[0].resolve('Zwei Agents laufen.\nSAY: Du hast zwei Agents.')
    await flush()
    expect(ports.speak).toHaveBeenCalledWith('Du hast zwei Agents.', 'de', expect.any(AbortSignal))
  })

  it('sends the transcript with the voice instruction and speaks the SAY line', async () => {
    const { controller, ports, phases, replies, hold } = setup({
      speak: vi.fn(async () => {}),
    })
    await hold()
    expect(ports.askBoss).toHaveBeenCalledWith(
      `list the agents ${voiceReplyInstruction('en')}`,
      expect.any(AbortSignal),
      expect.any(Function),
    )
    replies[0].resolve('Two agents are running.\nSAY: You have two agents.')
    await flush()
    expect(ports.speak).toHaveBeenCalledWith('You have two agents.', 'en', expect.any(AbortSignal))
    expect(phases).toEqual(['listening', 'transcribing', 'sending', 'waiting', 'speaking', 'idle'])
    expect(controller.getState().phase).toBe('idle')
  })

  it('cancels a short tap and releases the microphone', async () => {
    const { controller, ports, hold } = setup()
    await hold(MIN_VOICE_HOLD_MS - 1)
    expect(controller.getState().phase).toBe('cancelled')
    expect(ports.cancelRecording).toHaveBeenCalledTimes(1)
    expect(ports.transcribe).not.toHaveBeenCalled()
  })

  it('cancels listening on window blur', () => {
    const { controller, ports } = setup()
    controller.press()
    controller.blur()
    expect(controller.getState().phase).toBe('cancelled')
    expect(ports.cancelRecording).toHaveBeenCalledTimes(1)
  })

  it('fails with no-boss and never opens the microphone', () => {
    const { controller, ports } = setup({ hasBoss: () => false })
    controller.press()
    expect(controller.getState()).toMatchObject({ phase: 'error', reason: 'no-boss' })
    expect(ports.startRecording).not.toHaveBeenCalled()
  })

  it('pressing during speech stops playback and starts a new turn', async () => {
    const { controller, replies, speakSignals, hold } = setup()
    await hold()
    replies[0].resolve('SAY: Done.')
    await flush()
    expect(controller.getState().phase).toBe('speaking')

    controller.press()
    expect(speakSignals[0].aborted).toBe(true)
    expect(controller.getState()).toMatchObject({ phase: 'listening', turnId: 't2' })
  })

  it('a reply for an abandoned turn is never spoken', async () => {
    const { controller, ports, replies, askSignals, hold } = setup()
    await hold()
    expect(controller.getState().phase).toBe('waiting')

    controller.press()
    expect(askSignals[0].aborted).toBe(true)
    replies[0].resolve('SAY: Old answer.')
    await flush()
    expect(ports.speak).not.toHaveBeenCalled()
    expect(controller.getState()).toMatchObject({ phase: 'listening', turnId: 't2' })
  })

  it('ignores a press while a turn is still transcribing', async () => {
    let clock = 0
    const transcript = deferred<{ text: string; language: 'en' }>()
    const { controller, ports } = setup({
      transcribe: vi.fn(() => transcript.promise),
      now: () => clock,
    })
    controller.press()
    clock += MIN_VOICE_HOLD_MS + 1
    controller.release()
    controller.press()
    expect(controller.getState()).toMatchObject({ phase: 'transcribing', turnId: 't1' })
    expect(ports.startRecording).toHaveBeenCalledTimes(1)
  })

  it('goes idle without speaking when speak replies is off', async () => {
    const { controller, ports, replies, hold } = setup({ shouldSpeakReplies: () => false })
    await hold()
    replies[0].resolve('SAY: Done.')
    await flush()
    expect(ports.speak).not.toHaveBeenCalled()
    expect(controller.getState().phase).toBe('idle')
  })

  it('reports a microphone failure', async () => {
    const { controller } = setup({
      startRecording: vi.fn(async () => {
        throw new Error('NotAllowedError')
      }),
    })
    controller.press()
    await flush()
    expect(controller.getState()).toMatchObject({ phase: 'error', reason: 'mic-failed' })
  })

  it('reports no-speech without transcribing when the mic delivered no audio', async () => {
    const { controller, ports, hold } = setup({
      stopRecording: vi.fn(async () => new Float32Array(0)),
    })
    await hold()
    expect(controller.getState()).toMatchObject({ phase: 'error', reason: 'no-speech' })
    expect(ports.transcribe).not.toHaveBeenCalled()
  })

  it('reports no-speech for an empty transcript', async () => {
    const { controller, ports, hold } = setup({
      transcribe: vi.fn(async () => ({ text: '  ', language: 'en' as const })),
    })
    await hold()
    expect(controller.getState()).toMatchObject({ phase: 'error', reason: 'no-speech' })
    expect(ports.askBoss).not.toHaveBeenCalled()
  })
})
