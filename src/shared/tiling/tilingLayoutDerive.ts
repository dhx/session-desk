import {
  EMPTY_TILING_LAYOUT,
  TILING_LAYOUT_VERSION,
  equalTilingWeights,
  type CreateTilingId,
  type TilingGroup,
  type TilingLayout,
  type TilingNode,
} from './tilingLayout'

export interface TilingDeriveWindow {
  id: string
  /** Canvas position of the window's top-left corner. */
  x: number
  y: number
}

/**
 * The first layout of a Space, derived by the Worker (spec §1.2): windows in reading order (top
 * edge, then left edge, then id), placed row by row in a grid of `ceil(√n)` columns, one window per
 * group. Viewport-independent on purpose: every client gets the same tree and projects it onto its
 * own screen. Also used by `resetLayout`.
 */
export function deriveInitialTilingLayout(
  windows: readonly TilingDeriveWindow[],
  createId: CreateTilingId,
): TilingLayout {
  const ordered = [...new Map(windows.map(window => [window.id, window])).values()].sort(
    (left, right) =>
      left.y - right.y ||
      left.x - right.x ||
      (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
  )
  if (ordered.length === 0) {
    return EMPTY_TILING_LAYOUT
  }

  const columns = Math.ceil(Math.sqrt(ordered.length))
  const rows: TilingNode[] = []
  for (let start = 0; start < ordered.length; start += columns) {
    const groups: TilingGroup[] = ordered.slice(start, start + columns).map(window => ({
      kind: 'group',
      id: createId(),
      nodeIds: [window.id],
      activeNodeId: window.id,
    }))
    rows.push(
      groups.length === 1
        ? groups[0]!
        : {
            kind: 'split',
            id: createId(),
            direction: 'row',
            children: groups,
            weights: equalTilingWeights(groups.length),
          },
    )
  }

  const root: TilingNode =
    rows.length === 1
      ? rows[0]!
      : {
          kind: 'split',
          id: createId(),
          direction: 'column',
          children: rows,
          weights: equalTilingWeights(rows.length),
        }
  return { version: TILING_LAYOUT_VERSION, root }
}
