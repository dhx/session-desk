import type { VoiceLanguage } from '../../../shared/contracts/dto'
import { buildVoicePrompt, pickSpokenText } from '../domain/voiceText'
import {
  IDLE_VOICE_TURN,
  reduceVoiceTurn,
  type VoiceErrorReason,
  type VoiceTurnEvent,
  type VoiceTurnState,
} from '../domain/voiceTurn'

export interface VoiceTurnPorts {
  /** Resolves once the microphone records. */
  startRecording(): Promise<void>
  /** Mono PCM at 16 kHz. */
  stopRecording(): Promise<Float32Array>
  cancelRecording(): void
  /** The words and the language they were heard in. */
  transcribe(pcm16k: Float32Array): Promise<{ text: string; language: VoiceLanguage }>
  /** The language the reply is asked for and spoken in, given the one the request was heard in. */
  replyLanguage(heard: VoiceLanguage): VoiceLanguage
  /** Types the prompt into the boss, calls onSent once it is submitted, and resolves with its reply. */
  askBoss(prompt: string, signal: AbortSignal, onSent: () => void): Promise<string | null>
  /** Resolves when playback ends or the signal aborts. */
  speak(text: string, language: VoiceLanguage, signal: AbortSignal): Promise<void>
  hasBoss(): boolean
  shouldSpeakReplies(): boolean
  createTurnId(): string
  now(): number
}

export interface VoiceTurnController {
  getState(): VoiceTurnState
  subscribe(listener: (state: VoiceTurnState) => void): () => void
  press(): void
  release(): void
  blur(): void
  dispose(): void
}

interface ActiveTurn {
  id: string
  pressedAtMs: number
  abort: AbortController
}

/**
 * Drives push-to-talk turns through `reduceVoiceTurn` and runs each phase's side effect.
 *
 * Invariants:
 * - Only the newest turn runs side effects: a new press aborts the previous turn's signal, and
 *   every step re-checks that its turn is still the active one before acting.
 * - The microphone is released whenever a turn leaves `listening` (sent, cancelled, or replaced).
 */
export function createVoiceTurnController(ports: VoiceTurnPorts): VoiceTurnController {
  let state: VoiceTurnState = IDLE_VOICE_TURN
  let turn: ActiveTurn | null = null
  const listeners = new Set<(state: VoiceTurnState) => void>()

  const dispatch = (event: VoiceTurnEvent): VoiceTurnState => {
    const next = reduceVoiceTurn(state, event)
    if (next !== state) {
      state = next
      for (const listener of listeners) {
        listener(state)
      }
    }
    return state
  }

  const isCurrent = (candidate: ActiveTurn): boolean =>
    turn === candidate && !candidate.abort.signal.aborted

  const fail = (candidate: ActiveTurn, reason: VoiceErrorReason): void => {
    if (isCurrent(candidate)) {
      dispatch({ type: 'failed', turnId: candidate.id, reason })
    }
  }

  const run = async (current: ActiveTurn): Promise<void> => {
    const turnId = current.id
    const { signal } = current.abort

    let transcript: string
    let heard: VoiceLanguage = 'en'
    try {
      const pcm = await ports.stopRecording()
      // A mic that delivered nothing heard nothing: an empty transcript becomes `no-speech`.
      if (pcm.length === 0) {
        transcript = ''
      } else {
        ;({ text: transcript, language: heard } = await ports.transcribe(pcm))
      }
    } catch {
      fail(current, 'transcribe-failed')
      return
    }
    if (!isCurrent(current)) {
      return
    }
    const sending = dispatch({ type: 'transcribed', turnId, text: transcript })
    if (sending.phase !== 'sending') {
      return
    }

    // One language for the whole turn: the boss is asked to write the spoken line in it, and the
    // speech model of that language reads it.
    const replyLanguage = ports.replyLanguage(heard)
    let reply: string | null
    try {
      reply = await ports.askBoss(
        buildVoicePrompt(sending.transcript, replyLanguage),
        signal,
        () => {
          if (isCurrent(current)) {
            dispatch({ type: 'sent', turnId })
          }
        },
      )
    } catch {
      fail(current, 'send-failed')
      return
    }
    if (!isCurrent(current)) {
      return
    }

    const spoken = ports.shouldSpeakReplies() && reply ? pickSpokenText(reply) : null
    if (dispatch({ type: 'replied', turnId, speak: spoken !== null }).phase !== 'speaking') {
      return
    }

    try {
      await ports.speak(spoken as string, replyLanguage, signal)
    } catch {
      fail(current, 'speak-failed')
      return
    }
    if (isCurrent(current)) {
      dispatch({ type: 'spoken', turnId })
    }
  }

  return {
    getState: () => state,
    subscribe: listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    press: () => {
      const turnId = ports.createTurnId()
      const previous = turn
      const next = dispatch({ type: 'press', turnId })
      if (next.phase !== 'listening' || next.turnId !== turnId) {
        return
      }
      previous?.abort.abort()
      const current: ActiveTurn = {
        id: turnId,
        pressedAtMs: ports.now(),
        abort: new AbortController(),
      }
      turn = current

      if (!ports.hasBoss()) {
        fail(current, 'no-boss')
        return
      }
      ports.startRecording().catch(() => {
        if (isCurrent(current)) {
          ports.cancelRecording()
          fail(current, 'mic-failed')
        }
      })
    },
    release: () => {
      if (!turn || state.phase !== 'listening') {
        return
      }
      const current = turn
      const next = dispatch({
        type: 'release',
        turnId: current.id,
        heldMs: ports.now() - current.pressedAtMs,
      })
      if (next.phase === 'transcribing') {
        void run(current)
      } else {
        ports.cancelRecording()
      }
    },
    blur: () => {
      if (turn && dispatch({ type: 'blur', turnId: turn.id }).phase === 'cancelled') {
        ports.cancelRecording()
      }
    },
    dispose: () => {
      turn?.abort.abort()
      if (state.phase === 'listening') {
        ports.cancelRecording()
      }
      turn = null
      listeners.clear()
    },
  }
}
