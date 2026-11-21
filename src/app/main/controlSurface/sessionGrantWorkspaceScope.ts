/**
 * Session Desk: an agent terminal (session grant) works inside its own workspace.
 *
 * Upstream lets a session grant list, read and prompt agents, read terminal snapshots and change
 * nodes, notes and Spaces of every workspace on the Worker. When workspaces belong to different
 * clients that leaks one client's work to another client's agents. This scope runs after the
 * grant policy (sessionGrantPolicy.ts):
 * - a node, session, Space or mount a request names that belongs to another workspace is refused,
 *   and so is any other project; names, selectors and unknown IDs go to the handler, which
 *   resolves them as before (and answers "not found" for unknown ones);
 * - Space locators by name, Worker branch or path search the grant's workspace only;
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

/** Which workspace owns each saved node, session and Space. */
interface OwnerIndex {
  readonly projects: readonly string[]
  readonly nodes: ReadonlyMap<string, string>
  readonly sessions: ReadonlyMap<string, string>
  readonly spaces: ReadonlyMap<string, string>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function outOfScope(kind: string): never {
  throw createAppError('common.forbidden', {
    debugMessage: `This ${kind} belongs to another workspace. Agent terminals can only reach nodes, sessions, Spaces and mounts of their own workspace.`,
  })
}

async function readOwnerIndex(deps: WorkspaceScopeDeps): Promise<OwnerIndex> {
  const state = normalizePersistedAppState(await (await deps.getPersistenceStore()).readAppState())
  const nodes = new Map<string, string>()
  const sessions = new Map<string, string>()
  const spaces = new Map<string, string>()
  for (const workspace of state?.workspaces ?? []) {
    for (const node of workspace.nodes) {
      nodes.set(node.id, workspace.id)
      if (typeof node.sessionId === 'string' && node.sessionId) {
        sessions.set(node.sessionId, workspace.id)
      }
    }
    for (const space of workspace.spaces) {
      spaces.set(space.id, workspace.id)
    }
  }
  return { projects: (state?.workspaces ?? []).map(w => w.id), nodes, sessions, spaces }
}

function sessionOwner(index: OwnerIndex, deps: WorkspaceScopeDeps, id: string): string | null {
  const saved = index.sessions.get(id)
  if (saved) {
    return saved
  }
  const agentNode = deps.agentNodeOfSession(id)
  return agentNode ? (index.nodes.get(agentNode) ?? null) : null
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

/** Throws common.forbidden when the request names something of another workspace. */
export async function assertGrantRequestInWorkspace(
  grant: SessionGrant,
  payload: unknown,
  deps: WorkspaceScopeDeps,
): Promise<void> {
  const targets: { key: string; id: string }[] = []
  collectTargets(payload, targets)
  const relevant = targets.filter(
    ({ key, id }) =>
      // @self, @parent and other selectors are resolved relative to the caller.
      !id.startsWith('@') &&
      (PROJECT_KEYS.has(key) ||
        SPACE_KEYS.has(key) ||
        NODE_KEYS.has(key) ||
        SESSION_KEYS.has(key) ||
        MOUNT_KEYS.has(key)),
  )
  if (relevant.length === 0) {
    return
  }
  let index: OwnerIndex | undefined
  const owners = async () => (index ??= await readOwnerIndex(deps))
  let foreignMounts: ReadonlySet<string> | undefined
  for (const { key, id } of relevant) {
    if (PROJECT_KEYS.has(key)) {
      if (id !== grant.projectId) {
        outOfScope('project')
      }
    } else if (SPACE_KEYS.has(key)) {
      const owner = (await owners()).spaces.get(id)
      if (owner && owner !== grant.projectId) {
        outOfScope('Space')
      }
    } else if (NODE_KEYS.has(key)) {
      const owner = (await owners()).nodes.get(id)
      if (owner && owner !== grant.projectId) {
        outOfScope('node')
      }
    } else if (SESSION_KEYS.has(key)) {
      const owner = sessionOwner(await owners(), deps, id)
      if (owner && owner !== grant.projectId) {
        outOfScope('session')
      }
    } else if (MOUNT_KEYS.has(key)) {
      if (!foreignMounts) {
        const others = (await owners()).projects.filter(p => p !== grant.projectId)
        const lists = await Promise.all(others.map(projectId => deps.listMounts({ projectId })))
        foreignMounts = new Set(lists.flatMap(list => list.mounts.map(m => m.mountId)))
      }
      if (foreignMounts.has(id)) {
        outOfScope('mount')
      }
    }
  }
}

const PROJECT_NARROWED_LOCATORS = new Set(['spaceName', 'workerBranch', 'workerPath'])

/** Space locators by name, Worker branch or path search every project unless they name one. */
function narrowLocators(grant: SessionGrant, value: unknown, depth = 0): unknown {
  if (depth > 8) {
    return value
  }
  if (Array.isArray(value)) {
    return value.map(item => narrowLocators(grant, item, depth + 1))
  }
  if (!isRecord(value)) {
    return value
  }
  const next: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    next[key] = narrowLocators(grant, item, depth + 1)
  }
  if (typeof value.kind === 'string' && PROJECT_NARROWED_LOCATORS.has(value.kind)) {
    next.projectId = grant.projectId
  }
  return next
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
  const index = await readOwnerIndex(deps)
  const ownSession = (sessionId: unknown) =>
    typeof sessionId === 'string' &&
    (sessionId === grant.sessionId || sessionOwner(index, deps, sessionId) === grant.projectId)
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
      const narrowed = narrowLocators(grant, payload)
      return WORKSPACE_SCOPED_LIST_OPERATIONS.has(operationId)
        ? scopeGrantListPayload(grant, narrowed)
        : narrowed
    },
    async scopeResult(grant: SessionGrant, operationId: string, value: unknown) {
      return WORKSPACE_FILTERED_RESULT_OPERATIONS.has(operationId)
        ? await filterGrantListResult(grant, operationId, value, deps)
        : value
    },
  }
}
