import {
  TILING_LAYOUT_VERSION,
  listTilingGroups,
  normalizeTilingWeights,
  type CreateTilingId,
  type TilingLayout,
  type TilingNode,
} from './tilingLayout'

/**
 * The single place that makes a layout valid for a Space's windows (spec §2 invariant 1, §4):
 *
 * - drops window ids that are not in `nodeIds`, and repeats of a window (the first in depth-first
 *   order stays);
 * - removes empty groups, collapses splits left with one child, renormalises weights;
 * - gives a group whose active window left its first window;
 * - appends windows missing from the layout to the default destination: the last group in
 *   depth-first order, or a new root group when the layout is empty;
 * - returns the empty layout (`root: null`) when no window is left;
 * - keeps the ids of everything that survives; a missing or repeated id gets a new one.
 *
 * Pure: the result depends only on its arguments (and `createId` for new ids).
 */
export function normalizeTilingLayout(
  layout: TilingLayout | null,
  nodeIds: readonly string[],
  createId: CreateTilingId,
): TilingLayout {
  const members = new Set(nodeIds)
  const placed = new Set<string>()
  const usedIds = new Set<string>()

  const claimId = (id: unknown): string => {
    if (typeof id === 'string' && id.length > 0 && !usedIds.has(id)) {
      usedIds.add(id)
      return id
    }
    let next = createId()
    while (usedIds.has(next)) {
      next = createId()
    }
    usedIds.add(next)
    return next
  }

  const rebuild = (node: TilingNode): TilingNode | null => {
    if (node.kind === 'group') {
      const windowIds: string[] = []
      for (const nodeId of Array.isArray(node.nodeIds) ? node.nodeIds : []) {
        if (members.has(nodeId) && !placed.has(nodeId)) {
          placed.add(nodeId)
          windowIds.push(nodeId)
        }
      }
      if (windowIds.length === 0) {
        return null
      }
      return {
        kind: 'group',
        id: claimId(node.id),
        nodeIds: windowIds,
        activeNodeId: windowIds.includes(node.activeNodeId) ? node.activeNodeId : windowIds[0]!,
      }
    }

    const id = claimId(node.id)
    const children: TilingNode[] = []
    const weights: number[] = []
    const sourceChildren = Array.isArray(node.children) ? node.children : []
    const sourceWeights = normalizeTilingWeights(node.weights ?? [], sourceChildren.length)
    sourceChildren.forEach((child, index) => {
      const rebuilt = rebuild(child)
      if (rebuilt) {
        children.push(rebuilt)
        weights.push(sourceWeights[index]!)
      }
    })
    if (children.length === 0) {
      return null
    }
    if (children.length === 1) {
      return children[0]!
    }
    return {
      kind: 'split',
      id,
      direction: node.direction === 'column' ? 'column' : 'row',
      children,
      weights: normalizeTilingWeights(weights, children.length),
    }
  }

  let root = layout?.root ? rebuild(layout.root) : null

  const missing = [...new Set(nodeIds)].filter(nodeId => !placed.has(nodeId))
  if (missing.length > 0) {
    if (!root) {
      root = { kind: 'group', id: claimId(null), nodeIds: missing, activeNodeId: missing[0]! }
    } else {
      const destination = listTilingGroups(root).at(-1)!
      root = replaceTilingNode(root, destination.id, {
        ...destination,
        nodeIds: [...destination.nodeIds, ...missing],
      })
    }
  }

  return { version: TILING_LAYOUT_VERSION, root }
}

/** Returns a copy of `root` with the node `id` (a split or a group) replaced by `next`. */
export function replaceTilingNode(root: TilingNode, id: string, next: TilingNode): TilingNode {
  if (root.id === id) {
    return next
  }
  if (root.kind === 'group') {
    return root
  }
  return { ...root, children: root.children.map(child => replaceTilingNode(child, id, next)) }
}
