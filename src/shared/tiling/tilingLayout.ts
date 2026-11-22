/**
 * The tiling layout of a Space (docs/canvas/TILING_VIEW_SPEC.md §4): a tree of splits with tab
 * groups as leaves. Pure data; every split and group has an id that is unique within the layout
 * and never reused, so commands can name their targets without paths.
 */

export const TILING_LAYOUT_VERSION = 1

/** `row`: children side by side, left to right. `column`: children stacked, top to bottom. */
export type TilingSplitDirection = 'row' | 'column'

export interface TilingSplit {
  kind: 'split'
  id: string
  direction: TilingSplitDirection
  /** At least two children. */
  children: TilingNode[]
  /** One per child, each positive, summing to 1. */
  weights: number[]
}

export interface TilingGroup {
  kind: 'group'
  id: string
  /** Window node ids shown as tabs, in tab order; at least one. */
  nodeIds: string[]
  /** One of `nodeIds`. */
  activeNodeId: string
}

export type TilingNode = TilingSplit | TilingGroup

export interface TilingLayout {
  version: typeof TILING_LAYOUT_VERSION
  /** `null` is the empty layout: the only valid layout of a Space with no windows. */
  root: TilingNode | null
}

/** Creates a new split or group id. The Worker passes a random one; tests pass a counter. */
export type CreateTilingId = () => string

export const EMPTY_TILING_LAYOUT: TilingLayout = { version: TILING_LAYOUT_VERSION, root: null }

/** Visits every node depth-first, parents before children, children in order. */
export function forEachTilingNode(
  root: TilingNode | null,
  visit: (node: TilingNode, parent: TilingSplit | null) => void,
): void {
  const walk = (node: TilingNode, parent: TilingSplit | null): void => {
    visit(node, parent)
    if (node.kind === 'split') {
      for (const child of node.children) {
        walk(child, node)
      }
    }
  }
  if (root) {
    walk(root, null)
  }
}

/** Groups in depth-first order: the reading order used for `1`–`9` and the fallback focus. */
export function listTilingGroups(root: TilingNode | null): TilingGroup[] {
  const groups: TilingGroup[] = []
  forEachTilingNode(root, node => {
    if (node.kind === 'group') {
      groups.push(node)
    }
  })
  return groups
}

/** Window ids in depth-first group order, tab order within a group. */
export function listTilingWindowIds(root: TilingNode | null): string[] {
  return listTilingGroups(root).flatMap(group => group.nodeIds)
}

export function findTilingNode(
  root: TilingNode | null,
  id: string,
): { node: TilingNode; parent: TilingSplit | null } | null {
  let found: { node: TilingNode; parent: TilingSplit | null } | null = null
  forEachTilingNode(root, (node, parent) => {
    if (!found && node.id === id) {
      found = { node, parent }
    }
  })
  return found
}

export function findTilingGroupOfWindow(
  root: TilingNode | null,
  nodeId: string,
): TilingGroup | null {
  return listTilingGroups(root).find(group => group.nodeIds.includes(nodeId)) ?? null
}

/** Equal weights for `count` children. */
export function equalTilingWeights(count: number): number[] {
  return Array.from({ length: count }, () => 1 / count)
}

/** Scales positive finite weights to sum 1; anything else becomes equal weights. */
export function normalizeTilingWeights(weights: readonly number[], count: number): number[] {
  if (
    weights.length !== count ||
    count === 0 ||
    weights.some(weight => !Number.isFinite(weight) || weight <= 0)
  ) {
    return equalTilingWeights(count)
  }
  const sum = weights.reduce((total, weight) => total + weight, 0)
  return weights.map(weight => weight / sum)
}
