import type { AppErrorDescriptor } from './error'

export type PersistWriteLevel = 'full' | 'no_scrollback' | 'settings_only'

export type PersistWriteFailureReason =
  | 'unavailable'
  | 'quota'
  | 'payload_too_large'
  | 'io'
  | 'unknown'

export type PersistWriteResult =
  | {
      ok: true
      level: PersistWriteLevel
      bytes: number
      revision?: number
    }
  | {
      ok: false
      reason: PersistWriteFailureReason
      error: AppErrorDescriptor
    }

export interface WriteWorkspaceStateRawInput {
  raw: string
}

export type PersistenceRecoveryReason = 'corrupt_db' | 'migration_failed'

export interface ReadAppStateResult {
  state: unknown | null
  recovery: PersistenceRecoveryReason | null
  /**
   * Set by a persistence that writes against a revision (the Web UI): hand it back to
   * acceptAppState once the renderer has taken this state in, so the next write is based on
   * it. A read the renderer discards must not become the base of its next write.
   */
  syncToken?: number
}

export interface AcceptAppStateInput {
  syncToken: number
}

export interface WriteAppStateInput {
  state: unknown
  allowEmptyWorkspaceOverwrite?: boolean | null
}

export interface ReadNodeScrollbackInput {
  nodeId: string
}

export interface WriteNodeScrollbackInput {
  nodeId: string
  scrollback: string | null
}

export interface ReadAgentNodePlaceholderScrollbackInput {
  nodeId: string
}

export interface WriteAgentNodePlaceholderScrollbackInput {
  nodeId: string
  scrollback: string | null
}
