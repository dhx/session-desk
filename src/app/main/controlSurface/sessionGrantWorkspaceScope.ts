/**
 * Session Desk: an agent terminal (session grant) works inside its own workspace.
 *
 * Upstream lets a session grant list, read and prompt agents, read terminal snapshots and change
 * nodes, notes and Spaces of every workspace on the Worker. When workspaces belong to different
 * clients that leaks one client's work to another client's agents. This scope runs after the
 * grant policy (sessionGrantPolicy.ts):
 * - every node, session, Space, project and mount a request names must belong to the grant's
 *   workspace; anything else is refused the same way, whether it exists or not;
 * - list operations that take a project are limited to the grant's workspace;
 * - list operations without a project filter return only the grant's workspace.
 * Callers with the Worker token or a Web UI session are not affected.
 */
import type { PersistenceStore } from '../../../platform/persistence/sqlite/PersistenceStore'
import { normalizePersistedAppState } from '../../../platform/persistence/sqlite/normalize'
import { createAppError } from '../../../shared/errors/appError'
import type { ListMountsInput, ListMountsResult } from '../../../shared/contracts/dto'
import type { SessionGrant } from './http/sessionGrantRegistry'

const PROJECT_KEYS = new Set(['projectId', 'workspaceId'])
const SPACE_KEYS = new Set(['spaceId', 'parentSpaceId'])
const NODE_KEYS = new Set([
  'nodeId',
  'taskNodeId',
  'agentNodeId',
  'spawnedByNodeId',
  'expectedCallerNodeId',
])
const SESSION_KEYS = new Set(['sessionId'])
const MOUNT_KEYS = new Set(['mountId'])

/** Every input field that names a workspace-owned target (checked by a contract test). */
export const WORKSPACE_TARGET_KEYS: ReadonlySet<string> = new Set([
  ...PROJECT_KEYS,
  ...SPACE_KEYS,
  ...NODE_KEYS,
  ...SESSION_KEYS,
  ...MOUNT_KEYS,
])

/** List operations whose input names the project to list; a grant always lists its own. */
export const WORKSPACE_SCOPED_LIST_OPERATIONS = new Set([
  'agent.list',
  'mount.list',
  'node.list',
  'plugin.window.list',
  'space.list',
  'worktree.list',
])

/** List operations without a project filter: their results are reduced to the grant's workspace. */
export const WORKSPACE_FILTERED_RESULT_OPERATIONS = new Set([
  'project.list',
  'session.list',
  'session.terminalAgentActivity.list',
])

export interface WorkspaceScopeDeps {
  getPersistenceStore(): Promise<PersistenceStore>
  listMounts(input: ListMountsInput): Promise<ListMountsResult>
  /** The canvas node of a live agent run, for sessions not (yet) saved on a node. */
  agentNodeOfSession(sessionId: string): string | null
}

interface WorkspaceIndex {
  readonly nodes: ReadonlySet<string>
  readonly sessions: ReadonlySet<string>
  readonly spaces: ReadonlySet<string>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function outOfScope(kind: string): never {
  throw createAppError('common.forbidden', {
    debugMessage: `This ${kind} is not in this agent's workspace. Agent terminals can only reach nodes, sessions and Spaces of their own workspace.`,
  })
}

async function readWorkspaceIndex(
  deps: WorkspaceScopeDeps,
  projectId: string,
): Promise<WorkspaceIndex> {
  const state = normalizePersistedAppState(await (await deps.getPersistenceStore()).readAppState())
  const workspace = state?.workspaces.find(item => item.id === projectId)
  const nodes = new Set<string>()
  const sessions = new Set<string>()
  const spaces = new Set<string>()
  for (const node of workspace?.nodes ?? []) {
    nodes.add(node.id)
    if (typeof node.sessionId === 'string' && node.sessionId) {
      sessions.add(node.sessionId)
    }
  }
  for (const space of workspace?.spaces ?? []) {
    spaces.add(space.id)
  }
  return { nodes, sessions, spaces }
}

function collectTargets(value: unknown, out: { key: string; id: string }[], depth = 0): void {
  if (depth > 8) {
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectTargets(item, out, depth + 1)
    }
    return
  }
  if (!isRecord(value)) {
    return
  }
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string' && item) {
      out.push({ key, id: item })
    } else {
      collectTargets(item, out, depth + 1)
    }
  }
}

/** Throws common.forbidden when the request names anything outside the grant's workspace. */
export async function assertGrantRequestInWorkspace(
  grant: SessionGrant,
  payload: unknown,
  deps: WorkspaceScopeDeps,
): Promise<void> {
  const targets: { key: string; id: string }[] = []
  collectTargets(payload, targets)
  const relevant = targets.filter(
    ({ key, id }) =>
      PROJECT_KEYS.has(key) ||
      SPACE_KEYS.has(key) ||
      SESSION_KEYS.has(key) ||
      MOUNT_KEYS.has(key) ||
      // @self, @parent and other selectors are resolved relative to the caller.
      (NODE_KEYS.has(key) && !id.startsWith('@')),
  )
  if (relevant.length === 0) {
    return
  }
  let index: WorkspaceIndex | undefined
  const workspace = async () => (index ??= await readWorkspaceIndex(deps, grant.projectId))
  let mounts: ReadonlySet<string> | undefined
  for (const { key, id } of relevant) {
    if (PROJECT_KEYS.has(key)) {
      if (id !== grant.projectId) {
        outOfScope('project')
      }
    } else if (SPACE_KEYS.has(key)) {
      if (!(await workspace()).spaces.has(id)) {
        outOfScope('Space')
      }
    } else if (NODE_KEYS.has(key)) {
      if (id !== grant.nodeId && !(await workspace()).nodes.has(id)) {
        outOfScope('node')
      }
    } else if (SESSION_KEYS.has(key)) {
      if (id === grant.sessionId || (await workspace()).sessions.has(id)) {
        continue
      }
      const agentNode = deps.agentNodeOfSession(id)
      if (!agentNode || !(await workspace()).nodes.has(agentNode)) {
        outOfScope('session')
      }
    } else if (MOUNT_KEYS.has(key)) {
      mounts ??= new Set(
        (await deps.listMounts({ projectId: grant.projectId })).mounts.map(m => m.mountId),
      )
      if (!mounts.has(id)) {
        outOfScope('mount')
      }
    }
  }
}

/** Limits a project-taking list to the grant's workspace. */
export function scopeGrantListPayload(grant: SessionGrant, payload: unknown): unknown {
  if (payload === null || payload === undefined) {
    return { projectId: grant.projectId }
  }
  if (isRecord(payload)) {
    return { ...payload, projectId: grant.projectId }
  }
  return payload
}

/** Reduces an unfiltered list result to the grant's workspace. */
export async function filterGrantListResult(
  grant: SessionGrant,
  operationId: string,
  value: unknown,
  deps: WorkspaceScopeDeps,
): Promise<unknown> {
  if (!isRecord(value)) {
    return value
  }
  if (operationId === 'project.list' && Array.isArray(value.projects)) {
    return {
      ...value,
      activeProjectId: value.activeProjectId === grant.projectId ? grant.projectId : null,
      projects: value.projects.filter(p => isRecord(p) && p.id === grant.projectId),
    }
  }
  const index = await readWorkspaceIndex(deps, grant.projectId)
  const ownSession = (sessionId: unknown) => {
    if (typeof sessionId !== 'string') {
      return false
    }
    if (sessionId === grant.sessionId || index.sessions.has(sessionId)) {
      return true
    }
    const agentNode = deps.agentNodeOfSession(sessionId)
    return Boolean(agentNode && index.nodes.has(agentNode))
  }
  if (operationId === 'session.list' && Array.isArray(value.sessions)) {
    return {
      ...value,
      sessions: value.sessions.filter(s => isRecord(s) && ownSession(s.sessionId)),
    }
  }
  if (operationId === 'session.terminalAgentActivity.list' && Array.isArray(value.entries)) {
    return { ...value, entries: value.entries.filter(e => isRecord(e) && ownSession(e.sessionId)) }
  }
  return value
}

export function createSessionGrantWorkspaceScope(deps: WorkspaceScopeDeps) {
  return {
    async scopeRequest(grant: SessionGrant, operationId: string, payload: unknown) {
      await assertGrantRequestInWorkspace(grant, payload, deps)
      return WORKSPACE_SCOPED_LIST_OPERATIONS.has(operationId)
        ? scopeGrantListPayload(grant, payload)
        : payload
    },
    async scopeResult(grant: SessionGrant, operationId: string, value: unknown) {
      return WORKSPACE_FILTERED_RESULT_OPERATIONS.has(operationId)
        ? await filterGrantListResult(grant, operationId, value, deps)
        : value
    },
  }
}
