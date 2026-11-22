import {
  equalTilingWeights,
  findTilingGroupOfWindow,
  findTilingNode,
  listTilingGroups,
  listTilingWindowIds,
  type CreateTilingId,
  type TilingGroup,
  type TilingLayout,
  type TilingNode,
  type TilingSplitDirection,
} from './tilingLayout'
import { normalizeTilingLayout, replaceTilingNode } from './tilingLayoutNormalize'

export type TilingEdge = 'top' | 'right' | 'bottom' | 'left'

/** Where `placeNew` puts a window next to the group the client had focused (spec §1.3). */
export type TilingPlacement = 'tab' | TilingSplitDirection

/**
 * One change a client asks for (spec §3.2). Targets are named by id; the reducer checks that each
 * still exists in the role the command expects before changing anything. `resetLayout` is not
 * here: it derives a fresh layout from the canvas (`deriveInitialTilingLayout`).
 */
export type TilingCommand =
  | { kind: 'setWeights'; splitId: string; between: [string, string]; weights: [number, number] }
  | { kind: 'split'; groupId: string; direction: TilingSplitDirection; nodeId: string }
  | { kind: 'moveWindow'; nodeId: string; toGroupId: string; index?: number }
  | { kind: 'moveToEdge'; nodeId: string; targetId: string; edge: TilingEdge }
  | { kind: 'activate'; groupId: string; nodeId: string }
  | { kind: 'toggleTabs'; targetId: string; activeNodeId?: string }
  | { kind: 'equalise'; splitId: string }
  | { kind: 'placeNew'; nodeId: string; nearGroupId: string; placement: TilingPlacement }

export type TilingCommandResult =
  /** `changed` is false when the command was valid but left the layout as it was. */
  | { kind: 'applied'; layout: TilingLayout; changed: boolean }
  /** A target no longer exists, or no longer has the role or neighbours the command expects. */
  | { kind: 'rejected_stale_target'; reason: string }
  /** The command can never apply, whatever the layout (bad numbers, nothing to split). */
  | { kind: 'rejected_invalid_command'; reason: string }

export interface TilingCommandContext {
  /** The Space's windows (`space.nodeIds`) at the time the command is applied. */
  nodeIds: readonly string[]
  createId: CreateTilingId
}

class Rejection {
  constructor(
    readonly kind: 'rejected_stale_target' | 'rejected_invalid_command',
    readonly reason: string,
  ) {}
}

const stale = (reason: string): Rejection => new Rejection('rejected_stale_target', reason)
const invalid = (reason: string): Rejection => new Rejection('rejected_invalid_command', reason)

/**
 * Applies one command. The layout is normalised against the Space's windows first (so a window
 * that just arrived is in its default destination) and again after the change (spec §2 invariant
 * 1). Pure: nothing is mutated; the result depends only on the arguments and `createId`.
 */
export function applyTilingCommand(
  layout: TilingLayout | null,
  command: TilingCommand,
  context: TilingCommandContext,
): TilingCommandResult {
  const base = normalizeTilingLayout(layout, context.nodeIds, context.createId)
  let nextRoot: TilingNode | null
  try {
    nextRoot = applyToRoot(base.root, command, context)
  } catch (error) {
    if (error instanceof Rejection) {
      return { kind: error.kind, reason: error.reason }
    }
    throw error
  }
  const next = normalizeTilingLayout(
    { version: base.version, root: nextRoot },
    context.nodeIds,
    context.createId,
  )
  const before = JSON.stringify(layout?.root ?? null)
  return { kind: 'applied', layout: next, changed: JSON.stringify(next.root) !== before }
}

function applyToRoot(
  currentRoot: TilingNode | null,
  command: TilingCommand,
  context: TilingCommandContext,
): TilingNode | null {
  if (!currentRoot) {
    throw stale('the layout is empty')
  }
  // Work on a copy; the helpers below mutate it freely.
  const root = structuredClone(currentRoot)

  switch (command.kind) {
    case 'setWeights': {
      const [left, right] = command.weights
      if (![left, right].every(weight => Number.isFinite(weight) && weight > 0)) {
        throw invalid('weights must be positive finite numbers')
      }
      const split = requireNode(root, command.splitId, 'split')
      const index = split.children.findIndex(child => child.id === command.between[0])
      if (index < 0 || split.children[index + 1]?.id !== command.between[1]) {
        throw stale('the two children are no longer adjacent in that split')
      }
      const pair = split.weights[index]! + split.weights[index + 1]!
      split.weights[index] = (left / (left + right)) * pair
      split.weights[index + 1] = (right / (left + right)) * pair
      return root
    }

    case 'split': {
      const group = requireNode(root, command.groupId, 'group')
      if (!group.nodeIds.includes(command.nodeId)) {
        throw stale('the window is no longer in that group')
      }
      if (group.nodeIds.length < 2) {
        throw invalid(
          'a group with one window has nothing to split off; place a new window instead',
        )
      }
      group.nodeIds = group.nodeIds.filter(nodeId => nodeId !== command.nodeId)
      return insertBeside(
        root,
        group.id,
        newGroup(command.nodeId, context.createId),
        command.direction,
        'after',
        context.createId,
      )
    }

    case 'moveWindow': {
      const target = requireNode(root, command.toGroupId, 'group')
      const source = requireWindow(root, command.nodeId)
      source.nodeIds = source.nodeIds.filter(nodeId => nodeId !== command.nodeId)
      const index = clampIndex(command.index, target.nodeIds.length)
      target.nodeIds.splice(index, 0, command.nodeId)
      target.activeNodeId = command.nodeId
      return root
    }

    case 'moveToEdge': {
      const source = requireWindow(root, command.nodeId)
      const target = findTilingNode(root, command.targetId)
      if (!target) {
        throw stale('the target no longer exists')
      }
      if (target.node.id === source.id && source.nodeIds.length === 1) {
        return root
      }
      source.nodeIds = source.nodeIds.filter(nodeId => nodeId !== command.nodeId)
      return insertBeside(
        root,
        target.node.id,
        newGroup(command.nodeId, context.createId),
        command.edge === 'left' || command.edge === 'right' ? 'row' : 'column',
        command.edge === 'left' || command.edge === 'top' ? 'before' : 'after',
        context.createId,
      )
    }

    case 'activate': {
      const group = requireNode(root, command.groupId, 'group')
      if (!group.nodeIds.includes(command.nodeId)) {
        throw stale('the window is no longer in that group')
      }
      group.activeNodeId = command.nodeId
      return root
    }

    case 'toggleTabs': {
      const found = findTilingNode(root, command.targetId)
      if (!found) {
        throw stale('the target no longer exists')
      }
      const target = found.node
      if (target.kind === 'split') {
        const nodeIds = listTilingWindowIds(target)
        const activeNodeId =
          command.activeNodeId && nodeIds.includes(command.activeNodeId)
            ? command.activeNodeId
            : listTilingGroups(target)[0]!.activeNodeId
        return replaceTilingNode(root, target.id, {
          kind: 'group',
          id: context.createId(),
          nodeIds,
          activeNodeId,
        })
      }
      if (target.nodeIds.length < 2) {
        return root
      }
      return replaceTilingNode(root, target.id, {
        kind: 'split',
        id: context.createId(),
        direction: 'row',
        children: target.nodeIds.map(nodeId => newGroup(nodeId, context.createId)),
        weights: equalTilingWeights(target.nodeIds.length),
      })
    }

    case 'equalise': {
      const split = requireNode(root, command.splitId, 'split')
      split.weights = equalTilingWeights(split.children.length)
      return root
    }

    case 'placeNew': {
      if (!context.nodeIds.includes(command.nodeId)) {
        throw stale('the window is not in the Space yet')
      }
      const current = requireWindow(root, command.nodeId)
      const near = findTilingNode(root, command.nearGroupId)
      if (!near || near.node.kind !== 'group') {
        // The focused group is gone: the window stays at its default destination (spec §1.3).
        return root
      }
      if (
        near.node.id === current.id &&
        (command.placement === 'tab' || current.nodeIds.length === 1)
      ) {
        current.activeNodeId = command.nodeId
        return root
      }
      current.nodeIds = current.nodeIds.filter(nodeId => nodeId !== command.nodeId)
      if (command.placement === 'tab') {
        near.node.nodeIds.push(command.nodeId)
        near.node.activeNodeId = command.nodeId
        return root
      }
      return insertBeside(
        root,
        near.node.id,
        newGroup(command.nodeId, context.createId),
        command.placement,
        'after',
        context.createId,
      )
    }
  }
}

function requireNode<Kind extends TilingNode['kind']>(
  root: TilingNode,
  id: string,
  kind: Kind,
): Extract<TilingNode, { kind: Kind }> {
  const found = findTilingNode(root, id)
  if (!found || found.node.kind !== kind) {
    throw stale(`no ${kind} ${id}`)
  }
  return found.node as Extract<TilingNode, { kind: Kind }>
}

function requireWindow(root: TilingNode, nodeId: string): TilingGroup {
  const group = findTilingGroupOfWindow(root, nodeId)
  if (!group) {
    throw stale(`window ${nodeId} is not in the layout`)
  }
  return group
}

function newGroup(nodeId: string, createId: CreateTilingId): TilingGroup {
  return { kind: 'group', id: createId(), nodeIds: [nodeId], activeNodeId: nodeId }
}

function clampIndex(index: number | undefined, length: number): number {
  if (index === undefined || !Number.isInteger(index)) {
    return length
  }
  return Math.max(0, Math.min(index, length))
}

/**
 * Puts `node` beside the node `targetId`: as a sibling when the target's parent already splits in
 * `direction`, taking half of the target's weight; otherwise target and node become a new split.
 */
function insertBeside(
  root: TilingNode,
  targetId: string,
  node: TilingNode,
  direction: TilingSplitDirection,
  side: 'before' | 'after',
  createId: CreateTilingId,
): TilingNode {
  const found = findTilingNode(root, targetId)!
  const parent = found.parent
  if (parent && parent.direction === direction) {
    const index = parent.children.findIndex(child => child.id === targetId)
    const half = parent.weights[index]! / 2
    const at = side === 'before' ? index : index + 1
    parent.weights[index] = half
    parent.children.splice(at, 0, node)
    parent.weights.splice(at, 0, half)
    return root
  }
  return replaceTilingNode(root, targetId, {
    kind: 'split',
    id: createId(),
    direction,
    children: side === 'before' ? [node, found.node] : [found.node, node],
    weights: [0.5, 0.5],
  })
}
