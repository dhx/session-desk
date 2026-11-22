// @vitest-environment node
// Session Desk: an agent terminal (session grant) reaches only its own workspace.
import { describe, expect, it } from 'vitest'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { createSessionGrantWorkspaceScope } from '../../../src/app/main/controlSurface/sessionGrantWorkspaceScope'
import { createControlSurfaceHttpServerContext } from '../../../src/app/main/controlSurface/controlSurfaceHttpServerContext'
import type { ControlSurfaceContext } from '../../../src/app/main/controlSurface/types'
import {
  createInMemoryPersistenceStore,
  createMinimalState,
} from './controlSurfaceHttpServer.sessionStreaming.testUtils'

const terminal = (id: string, sessionId: string) => ({
  id,
  kind: 'terminal',
  title: id,
  position: { x: 0, y: 0 },
  width: 400,
  height: 300,
  sessionId,
})

async function setup() {
  const store = createInMemoryPersistenceStore()
  const a = createMinimalState('/tmp/a', 'project-a', 'space-a').workspaces[0]
  const b = createMinimalState('/tmp/b', 'project-b', 'space-b').workspaces[0]
  Object.assign(a, { nodes: [terminal('node-a', 'session-a'), terminal('self', 'own-session')] })
  Object.assign(a.spaces[0], { nodeIds: ['node-a', 'self'] })
  Object.assign(b, { nodes: [terminal('node-b', 'session-b')] })
  Object.assign(b.spaces[0], { nodeIds: ['node-b'] })
  await store.writeAppState({
    formatVersion: 1,
    activeWorkspaceId: 'project-b',
    workspaces: [a, b],
  })

  const surface = createControlSurface({
    grantWorkspaceScope: createSessionGrantWorkspaceScope({
      getPersistenceStore: async () => store,
      listMounts: async ({ projectId }) => ({
        projectId,
        mounts: (projectId === 'project-a' ? ['mount-a'] : ['mount-b']).map(mountId => ({
          mountId,
          projectId,
          name: mountId,
          sortOrder: 0,
          endpointId: 'local',
          targetId: mountId,
        })),
      }),
      // A live agent run whose session is not saved on its node yet.
      agentNodeOfSession: id => ({ 'live-a': 'node-a', 'live-b': 'node-b' })[id] ?? null,
    }),
  })
  const echo = (id: string, kind: 'query' | 'command' = 'query') =>
    surface.register(id, {
      kind,
      validate: x => x,
      handle: (_ctx, payload) => ({ payload }),
      defaultErrorCode: 'common.unexpected',
    })
  for (const id of ['agent.get', 'agent.list', 'node.get', 'space.get', 'session.snapshot']) {
    echo(id)
  }
  for (const id of ['agent.prompt', 'node.create', 'note.create', 'task.claim']) {
    echo(id, 'command')
  }
  echo('filesystem.readFileTextInMount')
  surface.register('session.list', {
    kind: 'query',
    validate: x => x,
    handle: () => ({
      sessions: ['session-a', 'own-session', 'session-b', 'live-a', 'live-b', 'loose'].map(
        sessionId => ({ sessionId }),
      ),
    }),
    defaultErrorCode: 'common.unexpected',
  })
  surface.register('project.list', {
    kind: 'query',
    validate: x => x,
    handle: () => ({
      activeProjectId: 'project-b',
      projects: [{ id: 'project-a' }, { id: 'project-b' }],
    }),
    defaultErrorCode: 'common.unexpected',
  })

  const base = createControlSurfaceHttpServerContext({
    enableWebShell: false,
    ptyProtocolVersion: 1,
    replayWindowMaxBytes: 10,
  })
  const grantCtx: ControlSurfaceContext = {
    ...base,
    requestAuth: {
      kind: 'session-grant',
      grant: {
        projectId: 'project-a',
        spaceId: 'space-a',
        nodeId: 'self',
        sessionId: 'own-session',
        grantId: 'grant',
        tier: 'interact',
        createdAt: '',
      },
    },
  }
  const ownerCtx: ControlSurfaceContext = { ...base, requestAuth: { kind: 'bearer' } }
  const call = (ctx: ControlSurfaceContext, id: string, payload: unknown, kind = 'query') =>
    surface.invoke(ctx, { kind: kind as 'query', id, payload })
  return {
    grant: (id: string, payload: unknown, kind?: string) => call(grantCtx, id, payload, kind),
    owner: (id: string, payload: unknown, kind?: string) => call(ownerCtx, id, payload, kind),
  }
}

const refused = { ok: false, error: { code: 'common.forbidden' } }

describe('agent terminals stay in their workspace', () => {
  it('reaches nodes, sessions, Spaces and mounts of its own workspace', async () => {
    const { grant } = await setup()
    for (const [id, payload, kind] of [
      ['agent.get', { nodeId: 'node-a' }],
      ['agent.get', { sessionId: 'session-a' }],
      ['agent.get', { sessionId: 'live-a' }],
      ['agent.prompt', { nodeId: '@self', text: 'hi' }, 'command'],
      ['node.get', { nodeId: 'self' }],
      ['space.get', { spaceId: 'space-a' }],
      ['session.snapshot', { sessionId: 'own-session' }],
      ['node.create', { kind: 'note', spaceId: 'space-a', near: { nodeId: 'node-a' } }, 'command'],
      ['task.claim', { taskNodeId: 'node-a', agentNodeId: 'self' }, 'command'],
      ['filesystem.readFileTextInMount', { mountId: 'mount-a', uri: 'file:///tmp/a/x' }],
    ] as const) {
      expect(await grant(id, payload, kind), `${id} ${JSON.stringify(payload)}`).toMatchObject({
        ok: true,
      })
    }
  })

  it('refuses whatever belongs to another workspace', async () => {
    const { grant } = await setup()
    for (const [id, payload, kind] of [
      ['agent.get', { nodeId: 'node-b' }],
      ['agent.get', { sessionId: 'session-b' }],
      ['agent.get', { sessionId: 'live-b' }],
      ['agent.prompt', { nodeId: 'node-b', text: 'hi' }, 'command'],
      ['agent.list', { projectId: 'project-b' }],
      ['agent.list', { spaceId: 'space-b' }],
      ['node.get', { nodeId: 'node-b' }],
      ['space.get', { spaceId: 'space-b' }],
      ['session.snapshot', { sessionId: 'session-b' }],
      ['note.create', { spaceId: 'space-b', text: 'x' }, 'command'],
      ['node.create', { kind: 'note', space: { projectId: 'project-b' } }, 'command'],
      ['node.create', { kind: 'note', spaceId: 'space-a', near: { nodeId: 'node-b' } }, 'command'],
      ['task.claim', { taskNodeId: 'node-b', agentNodeId: 'self' }, 'command'],
      ['filesystem.readFileTextInMount', { mountId: 'mount-b', uri: 'file:///tmp/b/x' }],
    ] as const) {
      expect(await grant(id, payload, kind), `${id} ${JSON.stringify(payload)}`).toMatchObject(
        refused,
      )
    }
  })

  it('leaves names, selectors and unknown IDs to the handler, inside its workspace', async () => {
    const { grant } = await setup()
    for (const [id, payload] of [
      ['agent.get', { nodeId: 'codex · Reviewer' }],
      ['space.get', { spaceId: 'Main' }],
      ['node.get', { nodeId: 'does-not-exist' }],
    ] as const) {
      expect(await grant(id, payload), `${id} ${JSON.stringify(payload)}`).toMatchObject({
        ok: true,
        value: { payload },
      })
    }
    expect(
      await grant(
        'node.create',
        { kind: 'note', space: { kind: 'spaceName', name: 'Main' } },
        'command',
      ),
    ).toMatchObject({
      ok: true,
      value: { payload: { space: { kind: 'spaceName', name: 'Main', projectId: 'project-a' } } },
    })
  })

  it('lists only its own workspace', async () => {
    const { grant } = await setup()
    expect(await grant('agent.list', {})).toMatchObject({
      ok: true,
      value: { payload: { projectId: 'project-a' } },
    })
    expect(await grant('session.list', {})).toMatchObject({
      ok: true,
      value: {
        sessions: [
          { sessionId: 'session-a' },
          { sessionId: 'own-session' },
          { sessionId: 'live-a' },
        ],
      },
    })
    expect(await grant('project.list', {})).toMatchObject({
      ok: true,
      value: { activeProjectId: null, projects: [{ id: 'project-a' }] },
    })
  })

  it('leaves the Worker owner and the Web UI unrestricted', async () => {
    const { owner } = await setup()
    expect(await owner('agent.get', { nodeId: 'node-b' })).toMatchObject({ ok: true })
    expect(await owner('agent.list', {})).toMatchObject({ ok: true, value: { payload: {} } })
    expect(await owner('session.list', {})).toMatchObject({
      ok: true,
      value: { sessions: { length: 6 } },
    })
  })
})

// Upstream adds operations quickly. Every ID field an agent terminal may send must either be
// checked against its workspace or be listed here with the reason it cannot reach another one.
const NOT_WORKSPACE_TARGETS: Record<string, string> = {
  deliveryId: 'random ID of a delivery the caller made itself',
  turnId: 'selects a turn of the node or session named next to it',
  promptId: 'selects a turn of the node or session named next to it',
  expectTurnId: 'guards a prompt to the node or session named next to it',
  resumeSessionId: "the provider's conversation, checked by the launch policy",
  activationId: 'a launch fence, checked by the launch policy',
  profileId: 'terminal profiles are shared by all workspaces',
  endpointId: 'endpoints are shared by all workspaces',
  pluginId: 'plugins are shared by all workspaces',
  viewId: 'a plugin view the caller was given',
  skillId: 'a skill of a plugin',
  id: 'an operation name (system.operation.describe)',
  operationId: 'chosen by the caller to recognise its own tiling event',
  splitId: 'a place in the tiling layout of the Space named next to it',
  groupId: 'a place in the tiling layout of the Space named next to it',
  toGroupId: 'a place in the tiling layout of the Space named next to it',
  nearGroupId: 'a place in the tiling layout of the Space named next to it',
  targetId: 'a place in the tiling layout of the Space named next to it',
  activeNodeId: 'a window the tiling layout of the Space named next to it already holds',
}

it('checks or names every ID field an agent terminal can send', async () => {
  const { CONTROL_SURFACE_OPERATIONS } =
    await import('../../../src/shared/contracts/controlSurface/operations')
  const { sessionGrantAccess } =
    await import('../../../src/app/main/controlSurface/http/sessionGrantAuthorization')
  const { WORKSPACE_TARGET_KEYS } =
    await import('../../../src/app/main/controlSurface/sessionGrantWorkspaceScope')
  type Def = { _zod?: { def?: Record<string, unknown> } }
  const keys = (schema: unknown, out: Set<string>, depth = 0): void => {
    const def = (schema as Def | undefined)?._zod?.def
    if (!def || depth > 8) {
      return
    }
    for (const [key, value] of Object.entries((def.shape as Record<string, unknown>) ?? {})) {
      out.add(key)
      keys(value, out, depth + 1)
    }
    for (const option of (def.options as unknown[]) ?? []) {
      keys(option, out, depth + 1)
    }
    for (const inner of ['innerType', 'in', 'out', 'schema', 'element', 'left', 'right']) {
      if (def[inner]) {
        keys(def[inner], out, depth + 1)
      }
    }
  }
  const unchecked: string[] = []
  for (const op of CONTROL_SURFACE_OPERATIONS) {
    if (sessionGrantAccess(op.id).access === 'denied') {
      continue
    }
    const fields = new Set<string>()
    keys((op as { input?: unknown }).input, fields)
    for (const field of fields) {
      if (
        /(^id|Id)$/.test(field) &&
        !WORKSPACE_TARGET_KEYS.has(field) &&
        !(field in NOT_WORKSPACE_TARGETS)
      ) {
        unchecked.push(`${op.id}: ${field}`)
      }
    }
  }
  expect(unchecked).toEqual([])
})
