import { randomUUID } from 'node:crypto'
import type { ControlSurface } from '../controlSurface'
import type { ControlSurfaceContext } from '../types'
import type { WorkerTopologyStore } from '../topology/topologyStore'
import { createAppError } from '../../../../shared/errors/appError'
import { isLabelColor, type LabelColor } from '../../../../shared/types/labelColor'
import type {
  CreateSpaceInput,
  CreateSpaceResult,
  SpaceAttributesDto,
  SyncEventPayload,
  UpdateSpaceInput,
  UpdateSpaceResult,
} from '../../../../shared/contracts/dto'
import type { PersistenceStore } from '../../../../platform/persistence/sqlite/PersistenceStore'
import {
  normalizePersistedAppState,
  type NormalizedPersistedAppState,
  type NormalizedPersistedSpace,
  type NormalizedPersistedWorkspace,
} from '../../../../platform/persistence/sqlite/normalize'
import {
  createTopLevelSpace,
  resolveEmptySpaceSize,
  updateSpaceAttributes,
} from '../../../../contexts/space/application/createTopLevelSpace'
import { resolveSpaceMountContext } from '../../../../contexts/space/application/resolveSpaceMountContext'
import { isPathInsideOrEqual } from '../../../../contexts/space/application/spaceBoundaryPolicy'
import { normalizeAgentSettings } from '../../../../contexts/settings/domain/agentSettings'
import { resolveAgentNodeSize } from '../../../../contexts/workspace/domain/workspaceNodeSizing'

const MAX_WRITE_ATTEMPTS = 3

function invalid(debugMessage: string): never {
  throw createAppError('common.invalid_input', { debugMessage })
}

function record(value: unknown, operation: string, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalid(`Invalid payload for ${operation}.`)
  }
  const input = value as Record<string, unknown>
  const unknown = Object.keys(input).find(key => !allowed.includes(key))
  if (unknown) {
    invalid(`Unsupported field for ${operation}: ${unknown}.`)
  }
  return input
}

function text(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength) {
    invalid(`Invalid ${field}.`)
  }
  return value.trim()
}

function labelColor(value: unknown): LabelColor | null | undefined {
  if (value === undefined || value === null) {
    return value
  }
  if (!isLabelColor(value)) {
    invalid('Invalid labelColor; use gray, red, orange, yellow, green, blue, purple or null.')
  }
  return value
}

function normalizeCreatePayload(payload: unknown): CreateSpaceInput {
  const input = record(payload, 'space.create', [
    'projectId',
    'name',
    'labelColor',
    'directoryPath',
  ])
  return {
    projectId: text(input.projectId, 'projectId', 200),
    name: text(input.name, 'name', 120),
    labelColor: labelColor(input.labelColor) ?? null,
    directoryPath:
      input.directoryPath === undefined || input.directoryPath === null
        ? null
        : text(input.directoryPath, 'directoryPath', 4096),
  }
}

function normalizeUpdatePayload(payload: unknown): UpdateSpaceInput {
  const input = record(payload, 'space.update', ['spaceId', 'name', 'labelColor'])
  const next: UpdateSpaceInput = { spaceId: text(input.spaceId, 'spaceId', 200) }
  if (input.name !== undefined) {
    next.name = text(input.name, 'name', 120)
  }
  if (input.labelColor !== undefined) {
    next.labelColor = labelColor(input.labelColor)
  }
  if (next.name === undefined && next.labelColor === undefined) {
    invalid('space.update needs a name or a labelColor.')
  }
  return next
}

const FAILURES: Record<string, string> = {
  name_required: 'A Space needs a name.',
  name_taken: 'This project already has a Space with that name.',
  no_slot: 'No free place on the canvas for a new Space.',
}

function toSpaceAttributes(space: NormalizedPersistedSpace): SpaceAttributesDto {
  return {
    id: space.id,
    name: space.name,
    labelColor: space.labelColor,
    directoryPath: space.directoryPath,
    targetMountId: space.targetMountId,
    parentSpaceId: space.parentSpaceId,
    rect: space.rect,
  }
}

function isRevisionConflict(error: { code: string; debugMessage?: string }): boolean {
  return (
    error.code === 'persistence.invalid_state' &&
    /^App state revision conflict(?:\s|\(|$)/.test(error.debugMessage ?? '')
  )
}

/**
 * Plans on a fresh snapshot and writes only if nothing else wrote in between; a conflict
 * re-plans, so a concurrent canvas save is never overwritten.
 */
async function commitWorkspaceChange<T>(
  ctx: ControlSurfaceContext,
  store: PersistenceStore,
  plan: (state: NormalizedPersistedAppState) => {
    workspace: NormalizedPersistedWorkspace
    result: T
  },
): Promise<{ revision: number; result: T }> {
  /* eslint-disable no-await-in-loop -- Each bounded attempt must use a fresh snapshot. */
  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt++) {
    ctx.assertActive?.()
    const expectedRevision = await store.readAppStateRevision()
    const state = normalizePersistedAppState(await store.readAppState())
    if (!state) {
      invalid('No app state to change.')
    }
    const { workspace, result } = plan(state)
    ctx.assertActive?.()
    const written = await store.writeAppState(
      {
        ...state,
        workspaces: state.workspaces.map(item => (item.id === workspace.id ? workspace : item)),
      },
      { expectedRevision },
    )
    if (written.ok) {
      return { revision: written.revision ?? (await store.readAppStateRevision()), result }
    }
    if (!isRevisionConflict(written.error) || attempt === MAX_WRITE_ATTEMPTS - 1) {
      throw createAppError(written.error)
    }
  }
  /* eslint-enable no-await-in-loop */
  throw new Error('Space change persistence attempts exhausted.')
}

export function registerSpaceMutationHandlers(
  controlSurface: ControlSurface,
  deps: {
    getPersistenceStore: () => Promise<PersistenceStore>
    topology: Pick<WorkerTopologyStore, 'listMounts'>
    publishSyncEvent?: (payload: SyncEventPayload) => number
  },
): void {
  // Writes from a plugin backend do not pass the HTTP command path, which publishes for its
  // callers; open windows only learn about this change from the event sent here.
  const announce = (revision: number, operationId: string) =>
    deps.publishSyncEvent?.({ type: 'app_state.updated', revision, operationId })

  controlSurface.register('space.create', {
    kind: 'command',
    validate: normalizeCreatePayload,
    handle: async (ctx, input): Promise<CreateSpaceResult> => {
      const store = await deps.getPersistenceStore()
      const mounts = (await deps.topology.listMounts({ projectId: input.projectId })).mounts
      const { revision, result } = await commitWorkspaceChange(ctx, store, state => {
        const workspace = state.workspaces.find(item => item.id === input.projectId)
        if (!workspace) {
          invalid(`space.create: unknown project id: ${input.projectId}`)
        }
        const context = resolveSpaceMountContext({
          space: input.directoryPath ? { directoryPath: input.directoryPath } : null,
          workspacePath: workspace.path,
          mounts,
          fallbackToFirstMount: !input.directoryPath,
        })
        if (
          !context.mount ||
          (input.directoryPath && !isPathInsideOrEqual(context.mount.rootPath, input.directoryPath))
        ) {
          invalid(
            input.directoryPath
              ? 'space.create: directoryPath is outside every mount of the project.'
              : 'space.create: the project has no mount.',
          )
        }
        const planned = createTopLevelSpace({
          spaces: workspace.spaces,
          nodeFrames: workspace.nodes.map(node => ({
            id: node.id,
            x: node.position.x,
            y: node.position.y,
            width: node.width,
            height: node.height,
          })),
          name: input.name,
          labelColor: input.labelColor ?? null,
          targetMountId: context.mount.mountId,
          directoryPath: input.directoryPath ?? context.workingDirectory,
          size: resolveEmptySpaceSize(
            resolveAgentNodeSize({
              bucket: normalizeAgentSettings(state.settings).standardWindowSizeBucket,
            }),
          ),
          createId: randomUUID,
        })
        if (!planned.ok) {
          invalid(`space.create: ${FAILURES[planned.code]}`)
        }
        return {
          workspace: { ...workspace, spaces: planned.nextSpaces },
          result: { projectId: workspace.id, space: planned.space },
        }
      })
      announce(revision, 'space.create')
      return { revision, projectId: result.projectId, space: toSpaceAttributes(result.space) }
    },
    defaultErrorCode: 'common.unexpected',
  })

  controlSurface.register('space.update', {
    kind: 'command',
    validate: normalizeUpdatePayload,
    handle: async (ctx, input): Promise<UpdateSpaceResult> => {
      const store = await deps.getPersistenceStore()
      const { revision, result } = await commitWorkspaceChange(ctx, store, state => {
        const workspace = state.workspaces.find(item =>
          item.spaces.some(space => space.id === input.spaceId),
        )
        if (!workspace) {
          throw createAppError('space.not_found', {
            debugMessage: `space.update: unknown space id: ${input.spaceId}`,
          })
        }
        const updated = updateSpaceAttributes(workspace.spaces, input)
        if (!updated.ok) {
          invalid(`space.update: ${FAILURES[updated.code] ?? updated.code}`)
        }
        return {
          workspace: { ...workspace, spaces: updated.nextSpaces },
          result: { projectId: workspace.id, space: updated.space },
        }
      })
      announce(revision, 'space.update')
      return { revision, projectId: result.projectId, space: toSpaceAttributes(result.space) }
    },
    defaultErrorCode: 'common.unexpected',
  })
}
