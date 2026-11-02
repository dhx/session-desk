import { describe, expect, it } from 'vitest'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { registerSpaceMutationHandlers } from '../../../src/app/main/controlSurface/handlers/spaceMutationHandlers'
import type { ControlSurfaceContext } from '../../../src/app/main/controlSurface/types'
import type { PersistenceStore } from '../../../src/platform/persistence/sqlite/PersistenceStore'
import type { MountDto, SyncEventPayload } from '../../../src/shared/contracts/dto'
import { createAppErrorDescriptor } from '../../../src/shared/errors/appError'

const ctx = {
  now: () => new Date('2026-11-01T00:00:00.000Z'),
  capabilities: {},
} as unknown as ControlSurfaceContext

function mount(rootPath: string): MountDto {
  return {
    mountId: 'mount-1',
    projectId: 'workspace-1',
    name: 'repo',
    sortOrder: 0,
    endpointId: 'local',
    targetId: 'target-1',
    rootPath,
    rootUri: `file://${rootPath}`,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
  }
}

function initialState() {
  return {
    formatVersion: 1,
    activeWorkspaceId: 'workspace-1',
    settings: {},
    workspaces: [
      {
        id: 'workspace-1',
        name: 'Workspace',
        path: '/repo',
        worktreesRoot: '/repo',
        nodes: [
          {
            id: 'note-1',
            title: 'Note',
            kind: 'note',
            position: { x: 0, y: 0 },
            width: 400,
            height: 300,
          },
        ],
        spaces: [
          {
            id: 'space-1',
            name: 'Existing',
            directoryPath: '/repo',
            targetMountId: 'mount-1',
            nodeIds: [],
            rect: { x: 500, y: 0, width: 800, height: 600 },
          },
        ],
      },
    ],
  }
}

/** A store with a revision counter that refuses stale writes, as SQLite does. */
function createStore(options: { conflicts?: number } = {}) {
  let state: unknown = initialState()
  let revision = 1
  let conflicts = options.conflicts ?? 0
  const store = {
    readAppState: async () => state,
    readAppStateRevision: async () => revision,
    writeAppState: async (next: unknown, write?: { expectedRevision?: number }) => {
      if (conflicts > 0) {
        conflicts -= 1
        revision += 1
      }
      if (write?.expectedRevision !== undefined && write.expectedRevision !== revision) {
        return {
          ok: false,
          reason: 'unknown',
          error: createAppErrorDescriptor('persistence.invalid_state', {
            debugMessage: `App state revision conflict (expected=${write.expectedRevision}, current=${revision}).`,
          }),
        }
      }
      state = next
      revision += 1
      return { ok: true, level: 'full', bytes: 1, revision }
    },
  } as unknown as PersistenceStore
  return { store, state: () => state as ReturnType<typeof initialState> }
}

function setup(options: { conflicts?: number; mountRoot?: string } = {}) {
  const { store, state } = createStore(options)
  const events: SyncEventPayload[] = []
  const controlSurface = createControlSurface()
  registerSpaceMutationHandlers(controlSurface, {
    getPersistenceStore: async () => store,
    topology: {
      listMounts: async () => ({
        projectId: 'workspace-1',
        mounts: [mount(options.mountRoot ?? '/repo')],
      }),
    },
    publishSyncEvent: payload => {
      events.push(payload)
      return 1
    },
  })
  const run = (id: string, payload: unknown) =>
    controlSurface.invoke(ctx, { kind: 'command', id, payload })
  return { run, state, events }
}

describe('space.create', () => {
  it('adds a top-level Space beside the canvas content and tells open windows', async () => {
    const { run, state, events } = setup()
    const result = await run('space.create', {
      projectId: 'workspace-1',
      name: 'Client portal',
      labelColor: 'blue',
    })

    expect(result).toMatchObject({
      ok: true,
      value: {
        projectId: 'workspace-1',
        revision: 2,
        space: {
          name: 'Client portal',
          labelColor: 'blue',
          directoryPath: '/repo',
          targetMountId: 'mount-1',
          parentSpaceId: null,
        },
      },
    })
    const spaces = state().workspaces[0].spaces
    expect(spaces).toHaveLength(2)
    const created = spaces[1] as { rect: { x: number } }
    expect(created.rect.x).toBeGreaterThanOrEqual(1300)
    expect(events).toEqual([
      { type: 'app_state.updated', revision: 2, operationId: 'space.create' },
    ])
  })

  it('uses a directory inside the project mount and refuses one outside it', async () => {
    const { run } = setup()
    const inside = await run('space.create', {
      projectId: 'workspace-1',
      name: 'Docs',
      directoryPath: '/repo/docs',
    })
    expect(inside).toMatchObject({ ok: true, value: { space: { directoryPath: '/repo/docs' } } })

    const outside = await run('space.create', {
      projectId: 'workspace-1',
      name: 'Elsewhere',
      directoryPath: '/etc',
    })
    expect(outside).toMatchObject({ ok: false, error: { code: 'common.invalid_input' } })
  })

  it('refuses a name the project already has, an unknown project and a bad colour, writing nothing', async () => {
    const { run, state, events } = setup()
    const results = await Promise.all(
      [
        { projectId: 'workspace-1', name: 'existing' },
        { projectId: 'missing', name: 'New' },
        { projectId: 'workspace-1', name: 'New', labelColor: 'magenta' },
        { projectId: 'workspace-1', name: 'New', extra: true },
      ].map(payload => run('space.create', payload)),
    )
    expect(results.map(result => result.ok)).toEqual([false, false, false, false])
    expect(state().workspaces[0].spaces).toHaveLength(1)
    expect(events).toEqual([])
  })

  it('plans again on a fresh snapshot when another writer got in first', async () => {
    const { run, state } = setup({ conflicts: 1 })
    const result = await run('space.create', { projectId: 'workspace-1', name: 'Retry' })
    expect(result.ok).toBe(true)
    expect(state().workspaces[0].spaces.map(space => space.name)).toEqual(['Existing', 'Retry'])
  })
})

describe('space.update', () => {
  it('renames and recolours a Space and tells open windows', async () => {
    const { run, state, events } = setup()
    const result = await run('space.update', {
      spaceId: 'space-1',
      name: 'Renamed',
      labelColor: 'green',
    })
    expect(result).toMatchObject({
      ok: true,
      value: {
        projectId: 'workspace-1',
        space: { id: 'space-1', name: 'Renamed', labelColor: 'green' },
      },
    })
    expect(state().workspaces[0].spaces[0]).toMatchObject({ name: 'Renamed', labelColor: 'green' })
    expect(events).toHaveLength(1)
  })

  it('refuses an unknown Space and an update that changes nothing', async () => {
    const { run, events } = setup()
    expect(await run('space.update', { spaceId: 'missing', name: 'X' })).toMatchObject({
      ok: false,
      error: { code: 'space.not_found' },
    })
    expect(await run('space.update', { spaceId: 'space-1' })).toMatchObject({ ok: false })
    expect(events).toEqual([])
  })
})
