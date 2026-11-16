import { toAppErrorDescriptor } from '@shared/errors/appError'
import { invokeBrowserControlSurface } from './browserControlSurface'
import {
  mergePersistedAppStates,
  normalizeCanonicalPersistedAppStateForMerge,
  normalizePersistedAppStateForMerge,
  type BrowserPersistedAppState,
} from './browserOpenCoveApi.helpers'

type PersistenceApi = Window['opencoveApi']['persistence']

let lastKnownSyncRevision: number | null = null
let lastKnownSyncState: BrowserPersistedAppState | null = null

function setLastKnownSyncRevision(value: unknown): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return
  }

  lastKnownSyncRevision = Math.floor(value)
}

function setLastKnownSyncState(value: unknown): void {
  lastKnownSyncState = normalizePersistedAppStateForMerge(value)
}

// Reads the renderer has not taken in yet, by revision. The base of the next write (the
// revision it is checked against, and the snapshot a conflict merges against) moves only
// when the renderer accepts one: a read it discards (its canvas changed meanwhile) would
// otherwise let the next write go through at the new revision without the nodes that read
// brought, e.g. an agent window a plugin had just opened, while its terminal keeps running.
const MAX_PENDING_READS = 8
const pendingReads = new Map<number, unknown>()

function rememberRead(revision: unknown, state: unknown): number | undefined {
  if (typeof revision !== 'number' || !Number.isFinite(revision) || revision < 0) {
    return undefined
  }
  const token = Math.floor(revision)
  pendingReads.delete(token)
  pendingReads.set(token, state)
  while (pendingReads.size > MAX_PENDING_READS) {
    const oldest = pendingReads.keys().next().value
    if (oldest === undefined) {
      break
    }
    pendingReads.delete(oldest)
  }
  return token
}

function acceptRead(token: number): void {
  if (!pendingReads.has(token)) {
    return
  }
  const state = pendingReads.get(token)
  pendingReads.delete(token)
  // A write of our own since that read is the newer base.
  if (typeof lastKnownSyncRevision === 'number' && token < lastKnownSyncRevision) {
    return
  }
  setLastKnownSyncRevision(token)
  setLastKnownSyncState(state)
}

/** Test seam: forget the base and pending reads. */
export function resetBrowserPersistenceSyncBase(): void {
  lastKnownSyncRevision = null
  lastKnownSyncState = null
  pendingReads.clear()
}

export function createBrowserPersistenceApi(): PersistenceApi {
  return {
    readWorkspaceStateRaw: async () =>
      await invokeBrowserControlSurface<string | null>({
        kind: 'query',
        id: 'sync.readWorkspaceStateRaw',
        payload: null,
      }),
    writeWorkspaceStateRaw: async payload =>
      await invokeBrowserControlSurface({
        kind: 'command',
        id: 'sync.writeWorkspaceStateRaw',
        payload,
      }),
    readAppState: async () => {
      const value = await invokeBrowserControlSurface<{
        revision: number
        state: unknown | null
      }>({
        kind: 'query',
        id: 'sync.state',
        payload: null,
      })
      const syncToken = rememberRead(value.revision, value.state)
      return {
        state: value.state,
        recovery: null,
        ...(syncToken === undefined ? {} : { syncToken }),
      }
    },
    acceptAppState: payload => {
      if (typeof payload?.syncToken === 'number' && Number.isFinite(payload.syncToken)) {
        acceptRead(Math.floor(payload.syncToken))
      }
    },
    writeAppState: async payload => {
      const attemptWrite = async (
        state: unknown,
        baseRevision: number | null,
        options?: { allowEmptyWorkspaceOverwrite?: boolean },
      ): Promise<number> => {
        const response = await invokeBrowserControlSurface<{ revision: number }>({
          kind: 'command',
          id: 'sync.writeState',
          payload: {
            state,
            ...(typeof baseRevision === 'number' ? { baseRevision } : {}),
            ...(options?.allowEmptyWorkspaceOverwrite === true
              ? { allowEmptyWorkspaceOverwrite: true }
              : {}),
          },
        })
        setLastKnownSyncRevision(response.revision)
        setLastKnownSyncState(state)
        return response.revision
      }

      const state = payload.state

      const baseSnapshot = lastKnownSyncState

      try {
        const baseRevision =
          typeof lastKnownSyncRevision === 'number' ? lastKnownSyncRevision : null
        const revision = await attemptWrite(state, baseRevision, {
          allowEmptyWorkspaceOverwrite: payload.allowEmptyWorkspaceOverwrite === true,
        })

        return {
          ok: true,
          level: 'full',
          bytes: JSON.stringify(state).length,
          revision,
        } as const
      } catch (error) {
        const descriptor = toAppErrorDescriptor(error, 'persistence.invalid_state')
        const debugMessage = descriptor.debugMessage ?? ''
        const isRevisionConflict =
          descriptor.code === 'persistence.invalid_state' &&
          debugMessage.includes('revision conflict')

        if (!isRevisionConflict) {
          return { ok: false, reason: 'unknown', error: descriptor } as const
        }

        try {
          const latest = await invokeBrowserControlSurface<{
            revision: number
            state: unknown | null
          }>({
            kind: 'query',
            id: 'sync.state',
            payload: null,
          })
          setLastKnownSyncRevision(latest.revision)
          setLastKnownSyncState(latest.state)

          const latestState =
            latest.state === null ? null : normalizePersistedAppStateForMerge(latest.state)
          if (latest.state !== null && !latestState) {
            throw new Error('sync.state returned a malformed persisted state.', { cause: error })
          }
          const localState = normalizeCanonicalPersistedAppStateForMerge(state)
          if (!localState) {
            throw new Error('Local persistence state was not canonical.', { cause: error })
          }
          const merged = latestState
            ? mergePersistedAppStates(latestState, localState, baseSnapshot)
            : localState

          const revision = await attemptWrite(merged, latest.revision, {
            allowEmptyWorkspaceOverwrite: payload.allowEmptyWorkspaceOverwrite === true,
          })

          return {
            ok: true,
            level: 'full',
            bytes: JSON.stringify(merged).length,
            revision,
          } as const
        } catch (retryError) {
          return {
            ok: false,
            reason: 'unknown',
            error: toAppErrorDescriptor(retryError, 'persistence.invalid_state'),
          } as const
        }
      }
    },
    readNodeScrollback: async payload =>
      await invokeBrowserControlSurface<string | null>({
        kind: 'query',
        id: 'sync.readNodeScrollback',
        payload,
      }),
    writeNodeScrollback: async payload =>
      await invokeBrowserControlSurface({
        kind: 'command',
        id: 'sync.writeNodeScrollback',
        payload,
      }),
    readAgentNodePlaceholderScrollback: async () => null,
    writeAgentNodePlaceholderScrollback: async () => ({
      ok: true,
      level: 'full',
      bytes: 0,
    }),
  }
}
