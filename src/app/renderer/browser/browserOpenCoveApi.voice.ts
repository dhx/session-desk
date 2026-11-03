import {
  VOICE_LANGUAGES,
  type AppErrorCode,
  type AppErrorDescriptor,
  type VoiceEngineStatus,
  type VoiceLanguage,
  type VoiceSpeakChunkEvent,
} from '@shared/contracts/dto'
import { createAppError } from '@shared/errors/appError'
import { SpeechFrameDecoder, encodePcm16 } from '@shared/voice/voiceWire'
import { getBrowserQueryToken, invokeBrowserControlSurface } from './browserControlSurface'

type VoiceApi = NonNullable<Window['opencoveApi']['voice']>

/** How often the status is read while the models load; the web has no push channel for it. */
const STATUS_POLL_MS = 500

function createClientId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

/**
 * Voice in the Web UI: the same bridge the desktop preload offers, over the worker's `/voice/*`
 * routes. Each tab names itself to the worker, so its own requests queue behind each other while
 * another tab's get `voice.busy`.
 */
export function createBrowserVoiceApi(): VoiceApi {
  const clientId = createClientId()
  const statusListeners = new Set<(status: VoiceEngineStatus) => void>()
  const chunkListeners = new Set<(event: VoiceSpeakChunkEvent) => void>()
  const speaking = new Map<string, AbortController>()
  let pollTimer: ReturnType<typeof setTimeout> | null = null

  const voiceHeaders = (extra: Record<string, string> = {}): Record<string, string> => {
    const headers: Record<string, string> = {
      'x-opencove-voice': '1',
      'x-opencove-voice-client': clientId,
      ...extra,
    }
    const token = getBrowserQueryToken()
    if (token) {
      headers.authorization = `Bearer ${token}`
    }
    return headers
  }

  const emitStatus = (status: VoiceEngineStatus): void => {
    for (const listener of statusListeners) {
      listener(status)
    }
  }

  const getStatus = (): Promise<VoiceEngineStatus> =>
    invokeBrowserControlSurface<VoiceEngineStatus>({
      kind: 'query',
      id: 'voice.status',
      payload: null,
    })

  const pollWhileLoading = (): void => {
    if (pollTimer) {
      return
    }
    pollTimer = setTimeout(async () => {
      pollTimer = null
      const status = await getStatus().catch(() => null)
      if (status?.state === 'loading') {
        emitStatus(status)
        pollWhileLoading()
      }
    }, STATUS_POLL_MS)
  }

  const stopPolling = (): void => {
    if (pollTimer) {
      clearTimeout(pollTimer)
      pollTimer = null
    }
  }

  return {
    getStatus,
    onStatus: listener => {
      statusListeners.add(listener)
      return () => statusListeners.delete(listener)
    },
    prepare: async () => {
      emitStatus({ state: 'loading', progress: null })
      pollWhileLoading()
      try {
        const status = await invokeBrowserControlSurface<VoiceEngineStatus>({
          kind: 'command',
          id: 'voice.prepare',
          payload: null,
        })
        stopPolling()
        emitStatus(status)
        return status
      } catch (error) {
        stopPolling()
        // The worker keeps the failed status, including why (voice not installed, say).
        const status = await getStatus().catch(() => null)
        if (status) {
          emitStatus(status)
        }
        throw toAppError(error, 'voice.prepare_failed')
      }
    },
    transcribe: async ({ pcm16k }) => {
      const response = await fetch('/voice/transcribe', {
        method: 'POST',
        credentials: 'same-origin',
        headers: voiceHeaders({ 'content-type': 'application/octet-stream' }),
        body: encodePcm16(pcm16k),
      })
      const result = (await response.json().catch(() => null)) as {
        ok?: boolean
        text?: unknown
        language?: unknown
        error?: AppErrorDescriptor
      } | null
      if (!response.ok || !result?.ok || typeof result.text !== 'string') {
        throw describeFailure(response, result?.error, 'voice.transcribe_failed')
      }
      // A worker from before languages answered without one; it only heard English.
      const language = VOICE_LANGUAGES.includes(result.language as VoiceLanguage)
        ? (result.language as VoiceLanguage)
        : 'en'
      return { text: result.text, language }
    },
    speak: async ({ requestId, text, language }) => {
      if (speaking.has(requestId)) {
        throw createAppError('common.invalid_input', {
          debugMessage: `speak request ${requestId} is already running`,
        })
      }
      const controller = new AbortController()
      speaking.set(requestId, controller)
      let chunkCount = 0
      try {
        const response = await fetch('/voice/speak', {
          method: 'POST',
          credentials: 'same-origin',
          headers: voiceHeaders({ 'content-type': 'application/json' }),
          body: JSON.stringify({ text, language }),
          signal: controller.signal,
        })
        if (!response.ok || !response.body) {
          const result = (await response.json().catch(() => null)) as {
            error?: AppErrorDescriptor
          } | null
          throw describeFailure(response, result?.error, 'voice.speak_failed')
        }

        const reader = response.body.getReader()
        const decoder = new SpeechFrameDecoder()
        while (!controller.signal.aborted) {
          // eslint-disable-next-line no-await-in-loop -- Audio arrives and plays in order.
          const { value, done } = await reader.read()
          if (done) {
            break
          }
          for (const frame of decoder.push(value)) {
            chunkCount += 1
            for (const listener of chunkListeners) {
              listener({
                requestId,
                index: frame.sequence,
                sampleRate: frame.sampleRate,
                samples: frame.samples,
              })
            }
            if (controller.signal.aborted) {
              break
            }
          }
        }
        if (controller.signal.aborted) {
          void reader.cancel().catch(() => undefined)
          return { chunkCount, cancelled: true }
        }
        if (decoder.hasPartialFrame()) {
          throw createAppError('voice.speak_failed', {
            debugMessage: 'The speech stream ended inside a sentence.',
          })
        }
        return { chunkCount, cancelled: false }
      } catch (error) {
        if (controller.signal.aborted) {
          return { chunkCount, cancelled: true }
        }
        throw toAppError(error, 'voice.speak_failed')
      } finally {
        speaking.delete(requestId)
      }
    },
    onSpeakChunk: listener => {
      chunkListeners.add(listener)
      return () => chunkListeners.delete(listener)
    },
    cancelSpeak: async ({ requestId }) => {
      speaking.get(requestId)?.abort()
    },
  }
}

function describeFailure(
  response: Response,
  descriptor: AppErrorDescriptor | undefined,
  fallback: AppErrorCode,
): Error {
  return descriptor && typeof descriptor.code === 'string'
    ? createAppError(descriptor)
    : createAppError(fallback, { debugMessage: `The worker answered ${response.status}.` })
}

function toAppError(error: unknown, fallback: AppErrorCode): Error {
  if (error instanceof Error && 'code' in error) {
    return error
  }
  if (
    error &&
    typeof error === 'object' &&
    typeof (error as { code?: unknown }).code === 'string'
  ) {
    return createAppError(error as AppErrorDescriptor)
  }
  return createAppError(fallback, {
    debugMessage: error instanceof Error ? error.message : String(error),
  })
}
