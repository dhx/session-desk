import type { PtyHostProcess } from '../../../../platform/process/ptyHost/processTypes'
import type { VoiceLanguage, VoiceLanguageAvailability } from '../../../../shared/contracts/dto'
import {
  VoiceMissingError,
  VoiceModelsMissingError,
  type VoiceAudioChunk,
  type VoiceEngine,
  type VoiceModelProgress,
  type VoiceTranscription,
} from '../../application/VoiceEngine'
import { isVoiceHostReply, type VoiceHostReply, type VoiceHostRequest } from './voiceHostProtocol'

interface PendingRequest {
  onReply: (reply: VoiceHostReply) => void
  fail: (error: Error) => void
}

/**
 * Whisper (about 0.3 GB) and each spoken language (about 0.8 GB) stay in memory while the host
 * runs; an idle host gives it back.
 */
export const VOICE_HOST_IDLE_UNLOAD_MS = 10 * 60 * 1000

export interface LocalVoiceEngineOptions {
  /** Where the models are; read only, never downloaded into. */
  modelsDir: string
  /** Where the installation keeps its voices; read only, may be empty. */
  voiceDir: string
  /** Forks the voice host process. Called lazily, and again after the process exits. */
  createProcess: () => PtyHostProcess
  reportIssue: (message: string) => void
  createId?: () => string
  idleUnloadMs?: number
}

/**
 * Worker side of the local engine. Whisper and Pocket TTS run in a child process so inference never
 * blocks the worker's event loop, and so their libraries' process-wide handlers stay out of it.
 *
 * Invariants:
 * - Every request settles: by its own done/error reply, or by failure when the process exits.
 * - After the process exits, the next request forks a new one; models must be prepared again.
 * - A host with no request in flight for `idleUnloadMs` is stopped. That is reported to
 *   `onUnavailable` listeners, not as an issue.
 */
export class LocalVoiceEngine implements VoiceEngine {
  public readonly id = 'local' as const
  private host: PtyHostProcess | null = null
  private prepared = false
  private disposed = false
  private readonly pending = new Map<string, PendingRequest>()
  private readonly unavailableListeners = new Set<(reason: string) => void>()
  private readonly createId: () => string
  private idleTimer: ReturnType<typeof setTimeout> | null = null

  public constructor(private readonly options: LocalVoiceEngineOptions) {
    this.createId = options.createId ?? (() => crypto.randomUUID())
  }

  public prepare(
    onProgress: (progress: VoiceModelProgress) => void,
  ): Promise<VoiceLanguageAvailability[]> {
    return new Promise((resolve, reject) => {
      this.request(
        {
          type: 'prepare',
          id: this.createId(),
          modelsDir: this.options.modelsDir,
          voiceDir: this.options.voiceDir,
        },
        {
          onReply: reply => {
            if (reply.type === 'progress') {
              onProgress({ progress: reply.progress })
            } else if (reply.type === 'done') {
              this.prepared = true
              resolve(reply.languages ?? [])
            } else if (reply.type === 'error') {
              reject(
                reply.code === 'models_missing'
                  ? new VoiceModelsMissingError(reply.message)
                  : new Error(reply.message),
              )
            }
          },
          fail: reject,
        },
      )
    })
  }

  public transcribe(pcm16k: Float32Array): Promise<VoiceTranscription> {
    return new Promise((resolve, reject) => {
      this.request(
        { type: 'transcribe', id: this.createId(), pcm16k },
        {
          onReply: reply => {
            if (reply.type === 'done') {
              resolve({ text: reply.text ?? '', language: reply.language ?? 'en' })
            } else if (reply.type === 'error') {
              reject(new Error(reply.message))
            }
          },
          fail: reject,
        },
      )
    })
  }

  public async *speak(
    text: string,
    language: VoiceLanguage,
    signal: AbortSignal,
  ): AsyncGenerator<VoiceAudioChunk> {
    const id = this.createId()
    const chunks: VoiceAudioChunk[] = []
    let finished = false
    let failure: Error | null = null
    let wake: (() => void) | null = null
    const notify = (): void => {
      wake?.()
      wake = null
    }

    this.request(
      { type: 'speak', id, text, language },
      {
        onReply: reply => {
          if (reply.type === 'chunk') {
            chunks.push({
              index: reply.index,
              sampleRate: reply.sampleRate,
              samples: reply.samples,
            })
          } else if (reply.type === 'done') {
            finished = true
          } else if (reply.type === 'error') {
            failure =
              reply.code === 'voice_missing'
                ? new VoiceMissingError(reply.message)
                : new Error(reply.message)
          }
          notify()
        },
        fail: error => {
          failure = error
          notify()
        },
      },
    )

    const cancel = (): void => {
      this.post({ type: 'cancel', id })
      notify()
    }
    signal.addEventListener('abort', cancel, { once: true })
    try {
      while (true) {
        const next = chunks.shift()
        if (next) {
          yield next
          continue
        }
        if (failure) {
          throw failure
        }
        if (finished || signal.aborted) {
          return
        }
        // eslint-disable-next-line no-await-in-loop -- Waits for the host's next reply.
        await new Promise<void>(resolve => {
          wake = resolve
        })
      }
    } finally {
      signal.removeEventListener('abort', cancel)
      // The consumer stopped early: tell the host to stop synthesizing for nobody.
      if (!finished && !failure && !signal.aborted) {
        this.post({ type: 'cancel', id })
      }
    }
  }

  public onUnavailable(listener: (reason: string) => void): () => void {
    this.unavailableListeners.add(listener)
    return () => this.unavailableListeners.delete(listener)
  }

  public async dispose(): Promise<void> {
    this.disposed = true
    this.clearIdleTimer()
    const host = this.host
    this.host = null
    this.prepared = false
    this.failAll(new Error('voice engine disposed'))
    host?.kill()
  }

  private request(
    message: Exclude<VoiceHostRequest, { type: 'cancel' }>,
    pending: PendingRequest,
  ): void {
    if (this.disposed) {
      pending.fail(new Error('voice engine disposed'))
      return
    }
    this.clearIdleTimer()
    this.pending.set(message.id, pending)
    this.post(message)
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
  }

  private armIdleTimerIfIdle(): void {
    if (this.disposed || !this.host || this.pending.size > 0) {
      return
    }
    this.clearIdleTimer()
    this.idleTimer = setTimeout(
      () => this.unloadIdleHost(),
      this.options.idleUnloadMs ?? VOICE_HOST_IDLE_UNLOAD_MS,
    )
    // An idle voice host is no reason to keep the worker alive.
    this.idleTimer.unref?.()
  }

  private unloadIdleHost(): void {
    this.idleTimer = null
    const host = this.host
    if (!host || this.pending.size > 0) {
      return
    }
    // Dropped before the kill, so the exit that follows is not taken for a crash.
    this.host = null
    const wasPrepared = this.prepared
    this.prepared = false
    host.kill()
    if (wasPrepared) {
      for (const listener of this.unavailableListeners) {
        listener('voice engine unloaded after being idle')
      }
    }
  }

  private post(message: VoiceHostRequest): void {
    // A cancel must not fork a fresh process; the one it targeted is already gone.
    if (this.disposed || (message.type === 'cancel' && !this.host)) {
      return
    }
    this.ensureHost().postMessage(message, error => {
      if (error) {
        const pending = this.pending.get(message.id)
        this.pending.delete(message.id)
        pending?.fail(error)
      }
    })
  }

  private ensureHost(): PtyHostProcess {
    if (this.host) {
      return this.host
    }

    const host = this.options.createProcess()
    host.on('message', message => {
      if (!isVoiceHostReply(message)) {
        return
      }
      const pending = this.pending.get(message.id)
      const settled = message.type === 'done' || message.type === 'error'
      if (settled) {
        this.pending.delete(message.id)
      }
      pending?.onReply(message)
      if (settled) {
        this.armIdleTimerIfIdle()
      }
    })
    host.on('exit', code => {
      if (this.host !== host) {
        return
      }
      this.host = null
      this.clearIdleTimer()
      const wasPrepared = this.prepared
      this.prepared = false
      const reason = `voice engine process exited with code ${code}`
      this.failAll(new Error(reason))
      if (wasPrepared) {
        this.options.reportIssue(`[opencove] ${reason}`)
        for (const listener of this.unavailableListeners) {
          listener(reason)
        }
      }
    })
    host.on('error', error => {
      this.options.reportIssue(`[opencove] voice engine process error: ${JSON.stringify(error)}`)
    })
    host.stderr?.on('data', chunk => {
      this.options.reportIssue(`[voice-host] ${String(chunk).trimEnd()}`)
    })
    this.host = host
    return host
  }

  private failAll(error: Error): void {
    const pending = [...this.pending.values()]
    this.pending.clear()
    for (const request of pending) {
      request.fail(error)
    }
  }
}
