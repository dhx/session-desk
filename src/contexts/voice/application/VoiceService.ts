import type { VoiceEngineStatus, VoiceLanguage } from '../../../shared/contracts/dto'
import {
  VoiceMissingError,
  VoiceModelsMissingError,
  type VoiceAudioChunk,
  type VoiceEngine,
  type VoiceTranscription,
} from './VoiceEngine'

/**
 * Owns the engine's load state.
 *
 * Invariants:
 * - At most one model load runs; concurrent callers share it.
 * - Status is `ready` only while the engine holds loaded models; when the engine reports it lost
 *   them, status returns to `idle` and the next request loads again.
 * - A failed load leaves status `error` and does not stick: the next request retries.
 */
export class VoiceService {
  private status: VoiceEngineStatus = { state: 'idle' }
  private preparing: Promise<void> | null = null
  private loadAttempt: object | null = null
  private readonly listeners = new Set<(status: VoiceEngineStatus) => void>()
  private readonly stopWatchingEngine: () => void

  public constructor(private readonly engine: VoiceEngine) {
    this.stopWatchingEngine = engine.onUnavailable(() => {
      this.preparing = null
      this.loadAttempt = null
      this.setStatus({ state: 'idle' })
    })
  }

  public getStatus(): VoiceEngineStatus {
    return this.status
  }

  public onStatus(listener: (status: VoiceEngineStatus) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  public async prepare(): Promise<void> {
    if (this.status.state === 'ready') {
      return
    }

    if (!this.preparing) {
      this.preparing = this.load()
    }

    await this.preparing
  }

  private async load(): Promise<void> {
    // A newer load or an engine loss replaces `preparing`; a superseded load must not write status.
    const attempt = {}
    this.loadAttempt = attempt
    const isCurrent = (): boolean => this.loadAttempt === attempt
    this.setStatus({ state: 'loading', progress: null })
    try {
      const languages = await this.engine.prepare(progress => {
        if (isCurrent()) {
          this.setStatus({ state: 'loading', ...progress })
        }
      })
      if (isCurrent()) {
        this.setStatus({ state: 'ready', languages })
      }
    } catch (error) {
      if (isCurrent()) {
        this.preparing = null
        this.setStatus({
          state: 'error',
          ...(error instanceof VoiceModelsMissingError
            ? { reason: 'models_missing' as const }
            : {}),
          message: describeError(error),
        })
      }
      throw error
    }
  }

  public async transcribe(pcm16k: Float32Array): Promise<VoiceTranscription> {
    await this.prepare()
    const heard = await this.engine.transcribe(pcm16k)
    return { text: heard.text.trim(), language: heard.language }
  }

  /** Throws VoiceMissingError before loading anything when the language has no voice. */
  public async speak(
    text: string,
    language: VoiceLanguage,
    signal: AbortSignal,
    /** May return a promise; the next chunk is asked for only once it settles (backpressure). */
    onChunk: (chunk: VoiceAudioChunk) => void | Promise<void>,
  ): Promise<{ chunkCount: number; cancelled: boolean }> {
    await this.prepare()
    const status = this.status
    if (
      status.state === 'ready' &&
      !status.languages.some(entry => entry.language === language && entry.voiceInstalled)
    ) {
      throw new VoiceMissingError(`No voice is installed for ${language}.`)
    }
    let chunkCount = 0
    for await (const chunk of this.engine.speak(text, language, signal)) {
      if (signal.aborted) {
        break
      }
      await onChunk(chunk)
      chunkCount += 1
    }
    return { chunkCount, cancelled: signal.aborted }
  }

  public async dispose(): Promise<void> {
    this.stopWatchingEngine()
    this.listeners.clear()
    await this.engine.dispose()
  }

  private setStatus(status: VoiceEngineStatus): void {
    this.status = status
    for (const listener of this.listeners) {
      listener(status)
    }
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
