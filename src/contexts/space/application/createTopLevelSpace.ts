import type { LabelColor } from '../../../shared/types/labelColor'
import type { Size } from '../../workspace/domain/workspaceNodeSizing'
import { resolveWorkspaceNodesPlacement } from '../../workspace/domain/workspaceNodePlacement'
import { SPACE_MIN_SIZE, SPACE_NODE_PADDING } from '../../workspace/domain/workspaceSpaceLayout'
import type { ChildSpaceNodeFrame, ChildSpaceRecord } from './createChildSpace'

const SPACE_NAME_MAX_LENGTH = 120
// Clear of the inflated obstacle margin, so a new Space never reads as part of its neighbour.
const NEW_SPACE_GAP = SPACE_NODE_PADDING * 4

/** An empty top-level Space has room for one standard Agent window. */
export function resolveEmptySpaceSize(agentWindowSize: Size): Size {
  return {
    width: Math.max(SPACE_MIN_SIZE.width, agentWindowSize.width + SPACE_NODE_PADDING * 2),
    height: Math.max(SPACE_MIN_SIZE.height, agentWindowSize.height + SPACE_NODE_PADDING * 2),
  }
}

export function normalizeSpaceName(value: string | null | undefined): string | null {
  const name = (value ?? '').trim().slice(0, SPACE_NAME_MAX_LENGTH)
  return name.length > 0 ? name : null
}

/** Space names identify Spaces to people and integrations, so a project never repeats one. */
function isSpaceNameTaken(spaces: ChildSpaceRecord[], name: string, exceptId?: string): boolean {
  const wanted = name.toLowerCase()
  return spaces.some(space => space.id !== exceptId && space.name.trim().toLowerCase() === wanted)
}

type Frame = { x: number; y: number; width: number; height: number }

function anchorBesideContent(frames: Frame[]): { x: number; y: number } {
  if (frames.length === 0) {
    return { x: 0, y: 0 }
  }
  return {
    x: Math.max(...frames.map(frame => frame.x + frame.width)) + NEW_SPACE_GAP,
    y: Math.min(...frames.map(frame => frame.y)),
  }
}

export type CreateTopLevelSpaceResult<TSpace extends ChildSpaceRecord> =
  | { ok: true; space: TSpace; nextSpaces: TSpace[] }
  | { ok: false; code: 'name_required' | 'name_taken' | 'no_slot' }

/**
 * Plans an empty top-level Space for a caller without a canvas view (a plugin, the CLI):
 * to the right of everything on the canvas, never overlapping a window or another Space.
 */
export function createTopLevelSpace<TSpace extends ChildSpaceRecord>(options: {
  spaces: TSpace[]
  nodeFrames: ChildSpaceNodeFrame[]
  name: string | null | undefined
  labelColor: LabelColor | null
  targetMountId: string
  directoryPath: string
  size: Size
  createId: () => string
}): CreateTopLevelSpaceResult<TSpace> {
  const name = normalizeSpaceName(options.name)
  if (!name) {
    return { ok: false, code: 'name_required' }
  }
  if (isSpaceNameTaken(options.spaces, name)) {
    return { ok: false, code: 'name_taken' }
  }
  const spaceRects = options.spaces.flatMap(space => (space.rect ? [space.rect] : []))
  const resolved = resolveWorkspaceNodesPlacement({
    anchor: anchorBesideContent([...spaceRects, ...options.nodeFrames]),
    size: options.size,
    nodes: options.nodeFrames.map(frame => ({
      id: frame.id,
      position: { x: frame.x, y: frame.y },
      data: { width: frame.width, height: frame.height },
    })),
    spaceRects,
    preferredDirection: 'right',
  })
  if (!resolved.canPlace) {
    return { ok: false, code: 'no_slot' }
  }
  const space = {
    id: options.createId(),
    name,
    directoryPath: options.directoryPath,
    targetMountId: options.targetMountId,
    parentSpaceId: null,
    sortOrder:
      Math.max(
        -1,
        ...options.spaces.map(item =>
          typeof item.sortOrder === 'number' && Number.isFinite(item.sortOrder)
            ? Math.floor(item.sortOrder)
            : -1,
        ),
      ) + 1,
    labelColor: options.labelColor,
    nodeIds: [],
    rect: {
      x: Math.round(resolved.placement.x),
      y: Math.round(resolved.placement.y),
      width: options.size.width,
      height: options.size.height,
    },
  } as unknown as TSpace
  return { ok: true, space, nextSpaces: [...options.spaces, space] }
}

export type UpdateSpaceAttributesResult<TSpace extends ChildSpaceRecord> =
  | { ok: true; space: TSpace; nextSpaces: TSpace[] }
  | { ok: false; code: 'not_found' | 'name_required' | 'name_taken' }

/** Renames or recolours one Space. `labelColor: null` clears the colour; leaving it out keeps it. */
export function updateSpaceAttributes<TSpace extends ChildSpaceRecord>(
  spaces: TSpace[],
  input: { spaceId: string; name?: string; labelColor?: LabelColor | null },
): UpdateSpaceAttributesResult<TSpace> {
  const current = spaces.find(space => space.id === input.spaceId)
  if (!current) {
    return { ok: false, code: 'not_found' }
  }
  let name = current.name
  if (input.name !== undefined) {
    const requested = normalizeSpaceName(input.name)
    if (!requested) {
      return { ok: false, code: 'name_required' }
    }
    if (isSpaceNameTaken(spaces, requested, current.id)) {
      return { ok: false, code: 'name_taken' }
    }
    name = requested
  }
  const space = {
    ...current,
    name,
    labelColor: input.labelColor === undefined ? current.labelColor : input.labelColor,
  }
  return {
    ok: true,
    space,
    nextSpaces: spaces.map(item => (item.id === current.id ? space : item)),
  }
}
