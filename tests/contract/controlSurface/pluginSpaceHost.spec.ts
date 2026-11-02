// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { createPluginSpaceHost } from '../../../src/app/main/controlSurface/handlers/pluginSpaceHost'
import { registerSpaceHandlers } from '../../../src/app/main/controlSurface/handlers/spaceHandlers'
import { registerSpaceMutationHandlers } from '../../../src/app/main/controlSurface/handlers/spaceMutationHandlers'
import type { ControlSurfaceContext } from '../../../src/app/main/controlSurface/types'
import { PLUGIN_HOST_METHODS } from '../../../src/contexts/plugins/domain/pluginHostApi'
import type { PluginHostAuthority } from '../../../src/contexts/plugins/domain/pluginHostTypes'
import type { PersistenceStore } from '../../../src/platform/persistence/sqlite/PersistenceStore'
import type { SyncEventPayload } from '../../../src/shared/contracts/dto'

function setup() {
  let state: unknown = {
    formatVersion: 1,
    activeWorkspaceId: 'project',
    settings: {},
    workspaces: [
      {
        id: 'project',
        name: 'Project',
        path: '/repo',
        nodes: [],
        spaces: [
          {
            id: 'space-1',
            name: 'Board',
            directoryPath: '/repo',
            targetMountId: 'mount-1',
            nodeIds: [],
            rect: { x: 0, y: 0, width: 800, height: 600 },
          },
        ],
      },
    ],
  }
  let revision = 1
  const store = {
    readAppState: async () => state,
    readAppStateRevision: async () => revision,
    writeAppState: async (next: unknown) => {
      state = next
      revision += 1
      return { ok: true, level: 'full', bytes: 1, revision }
    },
  } as unknown as PersistenceStore
  const events: SyncEventPayload[] = []
  const control = createControlSurface()
  const deps = { getPersistenceStore: async () => store }
  registerSpaceHandlers(control, deps.getPersistenceStore)
  registerSpaceMutationHandlers(control, {
    ...deps,
    topology: {
      listMounts: async () => ({
        projectId: 'project',
        mounts: [
          {
            mountId: 'mount-1',
            projectId: 'project',
            name: 'repo',
            sortOrder: 0,
            endpointId: 'local',
            targetId: 'local',
            rootPath: '/repo',
            rootUri: 'file:///repo',
            createdAt: '',
            updatedAt: '',
          },
        ],
      }),
    },
    publishSyncEvent: payload => events.push(payload),
  })
  const host = createPluginSpaceHost(control, {
    ...deps,
    context: { now: () => new Date(), capabilities: {} } as unknown as ControlSurfaceContext,
  })
  let active = true
  const authority: PluginHostAuthority = {
    pluginId: 'session-board',
    ownerId: 'backend:1',
    assertActive: () => {
      if (!active) {
        throw new Error('Plugin backend retired.')
      }
    },
  }
  return { host, authority, events, retire: () => (active = false) }
}

describe('plugin Space host', () => {
  it('is part of the method inventory both bridges expose, without delete', () => {
    expect(PLUGIN_HOST_METHODS.spaces).toEqual(['list', 'create', 'update'])
  })

  it('lists, creates and renames Spaces of an explicit project', async () => {
    const { host, authority, events } = setup()
    const created = (await host.request(authority, 'spaces.create', {
      projectId: 'project',
      name: 'Client portal',
      labelColor: 'blue',
    })) as { space: { id: string } }
    expect(created).toMatchObject({ projectId: 'project', space: { name: 'Client portal' } })

    await host.request(authority, 'spaces.update', {
      spaceId: created.space.id,
      name: 'Client portal 2',
      labelColor: null,
    })
    const listed = await host.request(authority, 'spaces.list', { projectId: 'project' })
    expect(listed).toEqual({
      projectId: 'project',
      spaces: [
        {
          id: 'space-1',
          name: 'Board',
          labelColor: null,
          directoryPath: '/repo',
          parentSpaceId: null,
        },
        {
          id: created.space.id,
          name: 'Client portal 2',
          labelColor: null,
          directoryPath: '/repo',
          parentSpaceId: null,
        },
      ],
    })
    expect(events.map(event => event.type)).toEqual(['app_state.updated', 'app_state.updated'])
  })

  it('refuses unknown projects, unknown fields, delete and a retired caller', async () => {
    const { host, authority, retire } = setup()
    await expect(
      host.request(authority, 'spaces.create', { projectId: 'other', name: 'X' }),
    ).rejects.toThrow('Project is unavailable.')
    await expect(
      host.request(authority, 'spaces.create', { projectId: 'project', name: 'X', rect: {} }),
    ).rejects.toThrow('Unsupported plugin Space argument.')
    await expect(host.request(authority, 'spaces.delete', { spaceId: 'space-1' })).rejects.toThrow(
      'Unsupported plugin Space operation.',
    )
    retire()
    await expect(host.request(authority, 'spaces.list', { projectId: 'project' })).rejects.toThrow(
      'Plugin backend retired.',
    )
  })
})
