import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_AGENT_SETTINGS } from '@contexts/settings/domain/agentSettings'
import type { PersistedAppState } from '@contexts/workspace/presentation/renderer/types'
import { createAppError } from '@shared/errors/appError'

// A worker that checks writes against a revision, like sync.writeState.
const server = vi.hoisted(() => ({
  revision: 0,
  state: null as unknown,
  writes: [] as Array<{ baseRevision?: number; nodeIds: string[] }>,
}))

vi.mock('@app/renderer/browser/browserControlSurface', () => ({
  invokeBrowserControlSurface: async (request: { id: string; payload: unknown }) => {
    if (request.id === 'sync.state') {
      return { revision: server.revision, state: structuredClone(server.state) }
    }
    if (request.id === 'sync.writeState') {
      const payload = request.payload as { state: PersistedAppState; baseRevision?: number }
      server.writes.push({
        baseRevision: payload.baseRevision,
        nodeIds: payload.state.workspaces[0]?.nodes.map(node => node.id) ?? [],
      })
      if (typeof payload.baseRevision === 'number' && payload.baseRevision !== server.revision) {
        throw createAppError('persistence.invalid_state', { debugMessage: 'revision conflict' })
      }
      server.state = structuredClone(payload.state)
      server.revision += 1
      return { revision: server.revision }
    }
    throw new Error(`unexpected ${request.id}`)
  },
}))

import {
  createBrowserPersistenceApi,
  resetBrowserPersistenceSyncBase,
} from '@app/renderer/browser/browserOpenCoveApi.persistence'

function note(id: string, title = id) {
  return {
    id,
    title,
    position: { x: 0, y: 0 },
    width: 120,
    height: 90,
    kind: 'note' as const,
    status: null,
    startedAt: null,
    endedAt: null,
    exitCode: null,
    lastError: null,
    scrollback: null,
    agent: null,
    task: { text: '' },
  }
}

function state(nodes: ReturnType<typeof note>[]): PersistedAppState {
  return {
    formatVersion: 1,
    activeWorkspaceId: 'w1',
    settings: DEFAULT_AGENT_SETTINGS,
    workspaces: [
      {
        id: 'w1',
        name: 'Workspace',
        path: '/tmp/workspace',
        worktreesRoot: '/tmp/workspace',
        viewport: { x: 0, y: 0, zoom: 1 },
        isMinimapVisible: true,
        spaces: [],
        activeSpaceId: null,
        spaceArchiveRecords: [],
        nodes,
      },
    ],
  } as PersistedAppState
}

describe('Web UI persistence base', () => {
  beforeEach(() => {
    resetBrowserPersistenceSyncBase()
    server.revision = 1
    server.state = state([note('mine')])
    server.writes = []
  })

  it('keeps a node another client added when the renderer discarded the read that brought it', async () => {
    const api = createBrowserPersistenceApi()
    const first = await api.readAppState()
    api.acceptAppState?.({ syncToken: first.syncToken! })

    // A plugin opens a window: the worker's state gains a node.
    server.state = state([note('mine'), note('plugin-window')])
    server.revision += 1

    // The renderer reads it, but its canvas changed meanwhile, so it drops the read.
    const discarded = await api.readAppState()
    expect(discarded.syncToken).toBe(server.revision)

    // Its next save still lacks the node; it must not count as deleting it.
    const result = await api.writeAppState({ state: state([note('mine', 'moved')]) })
    expect(result.ok).toBe(true)
    expect(server.writes[0]).toMatchObject({ baseRevision: 1 })
    const saved = server.state as PersistedAppState
    expect(saved.workspaces[0]?.nodes.map(node => node.id).sort()).toEqual([
      'mine',
      'plugin-window',
    ])
    expect(saved.workspaces[0]?.nodes.find(node => node.id === 'mine')?.title).toBe('moved')
  })

  it('bases the next write on an accepted read, so a node the user closed stays closed', async () => {
    const api = createBrowserPersistenceApi()
    server.state = state([note('mine'), note('plugin-window')])
    const read = await api.readAppState()
    api.acceptAppState?.({ syncToken: read.syncToken! })

    const result = await api.writeAppState({ state: state([note('mine')]) })
    expect(result.ok).toBe(true)
    expect(server.writes).toEqual([{ baseRevision: 1, nodeIds: ['mine'] }])
    expect((server.state as PersistedAppState).workspaces[0]?.nodes.map(node => node.id)).toEqual([
      'mine',
    ])
  })

  it('does not move the base back to a read older than its own write', async () => {
    const api = createBrowserPersistenceApi()
    const old = await api.readAppState()
    api.acceptAppState?.({ syncToken: old.syncToken! })
    const stale = await api.readAppState()
    await api.writeAppState({ state: state([note('mine', 'saved')]) })
    api.acceptAppState?.({ syncToken: stale.syncToken! })

    await api.writeAppState({ state: state([note('mine', 'saved again')]) })
    expect(server.writes.map(write => write.baseRevision)).toEqual([1, 2])
  })
})
