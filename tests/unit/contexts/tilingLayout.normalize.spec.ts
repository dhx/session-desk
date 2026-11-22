import { describe, expect, it } from 'vitest'
import type { TilingLayout } from '../../../src/shared/tiling/tilingLayout'
import { normalizeTilingLayout } from '../../../src/shared/tiling/tilingLayoutNormalize'
import { deriveInitialTilingLayout } from '../../../src/shared/tiling/tilingLayoutDerive'

function counter(prefix = 'n') {
  let next = 0
  return () => `${prefix}${(next += 1)}`
}

const twoGroups: TilingLayout = {
  version: 1,
  root: {
    kind: 'split',
    id: 's1',
    direction: 'row',
    children: [
      { kind: 'group', id: 'g1', nodeIds: ['a', 'b'], activeNodeId: 'b' },
      { kind: 'group', id: 'g2', nodeIds: ['c'], activeNodeId: 'c' },
    ],
    weights: [0.25, 0.75],
  },
}

describe('normalizeTilingLayout', () => {
  it('gives the empty layout for a Space with no windows', () => {
    expect(normalizeTilingLayout(null, [], counter())).toEqual({ version: 1, root: null })
    expect(normalizeTilingLayout(twoGroups, [], counter())).toEqual({ version: 1, root: null })
  })

  it('puts all windows of a Space without a layout in one new root group', () => {
    expect(normalizeTilingLayout(null, ['a', 'b', 'a'], counter()).root).toEqual({
      kind: 'group',
      id: 'n1',
      nodeIds: ['a', 'b'],
      activeNodeId: 'a',
    })
  })

  it('keeps a valid layout unchanged', () => {
    expect(normalizeTilingLayout(twoGroups, ['a', 'b', 'c'], counter())).toEqual(twoGroups)
  })

  it('drops windows that left, fixes the active tab and keeps ids', () => {
    expect(normalizeTilingLayout(twoGroups, ['a', 'c'], counter()).root).toEqual({
      kind: 'split',
      id: 's1',
      direction: 'row',
      children: [
        { kind: 'group', id: 'g1', nodeIds: ['a'], activeNodeId: 'a' },
        { kind: 'group', id: 'g2', nodeIds: ['c'], activeNodeId: 'c' },
      ],
      weights: [0.25, 0.75],
    })
  })

  it('removes an emptied group and collapses a split left with one child', () => {
    expect(normalizeTilingLayout(twoGroups, ['c'], counter()).root).toEqual({
      kind: 'group',
      id: 'g2',
      nodeIds: ['c'],
      activeNodeId: 'c',
    })
  })

  it('renormalises the weights of the surviving children', () => {
    const three: TilingLayout = {
      version: 1,
      root: {
        kind: 'split',
        id: 's1',
        direction: 'column',
        children: [
          { kind: 'group', id: 'g1', nodeIds: ['a'], activeNodeId: 'a' },
          { kind: 'group', id: 'g2', nodeIds: ['b'], activeNodeId: 'b' },
          { kind: 'group', id: 'g3', nodeIds: ['c'], activeNodeId: 'c' },
        ],
        weights: [0.2, 0.3, 0.5],
      },
    }
    const root = normalizeTilingLayout(three, ['a', 'c'], counter()).root
    expect(root?.kind === 'split' && root.weights.map(weight => weight.toFixed(4))).toEqual([
      '0.2857',
      '0.7143',
    ])
  })

  it('appends new windows to the last group in depth-first order', () => {
    const root = normalizeTilingLayout(twoGroups, ['a', 'b', 'c', 'd', 'e'], counter()).root
    expect(root?.kind === 'split' && root.children[1]).toEqual({
      kind: 'group',
      id: 'g2',
      nodeIds: ['c', 'd', 'e'],
      activeNodeId: 'c',
    })
  })

  it('keeps the first of a repeated window and gives a repeated id a new one', () => {
    const broken: TilingLayout = {
      version: 1,
      root: {
        kind: 'split',
        id: 'x',
        direction: 'row',
        children: [
          { kind: 'group', id: 'x', nodeIds: ['a', 'b'], activeNodeId: 'a' },
          { kind: 'group', id: 'g2', nodeIds: ['b', 'c'], activeNodeId: 'b' },
        ],
        weights: [1, Number.NaN],
      },
    }
    expect(normalizeTilingLayout(broken, ['a', 'b', 'c'], counter()).root).toEqual({
      kind: 'split',
      id: 'x',
      direction: 'row',
      children: [
        { kind: 'group', id: 'n1', nodeIds: ['a', 'b'], activeNodeId: 'a' },
        { kind: 'group', id: 'g2', nodeIds: ['c'], activeNodeId: 'c' },
      ],
      weights: [0.5, 0.5],
    })
  })
})

describe('deriveInitialTilingLayout', () => {
  it('gives the empty layout for no windows and one group for one', () => {
    expect(deriveInitialTilingLayout([], counter())).toEqual({ version: 1, root: null })
    expect(deriveInitialTilingLayout([{ id: 'a', x: 5, y: 5 }], counter()).root).toEqual({
      kind: 'group',
      id: 'n1',
      nodeIds: ['a'],
      activeNodeId: 'a',
    })
  })

  it('lays windows out row by row in ceil(sqrt(n)) columns, in reading order', () => {
    const layout = deriveInitialTilingLayout(
      [
        { id: 'e', x: 0, y: 900 },
        { id: 'b', x: 500, y: 0 },
        { id: 'a', x: 0, y: 0 },
        { id: 'd', x: 100, y: 400 },
        { id: 'c', x: 900, y: 0 },
      ],
      counter(),
    )
    const root = layout.root
    expect(root?.kind).toBe('split')
    if (root?.kind !== 'split') {
      return
    }
    expect(root.direction).toBe('column')
    expect(
      root.children.map(row =>
        row.kind === 'split'
          ? row.children.map(group => (group.kind === 'group' ? group.nodeIds.join() : '?'))
          : [row.nodeIds.join()],
      ),
    ).toEqual([
      ['a', 'b', 'c'],
      ['d', 'e'],
    ])
  })

  it('breaks ties in position by id, so every client derives the same tree', () => {
    const windows = [
      { id: 'b', x: 0, y: 0 },
      { id: 'a', x: 0, y: 0 },
    ]
    const first = deriveInitialTilingLayout(windows, counter())
    const second = deriveInitialTilingLayout([...windows].reverse(), counter())
    expect(first).toEqual(second)
    expect(first.root?.kind === 'split' && first.root.children[0]).toMatchObject({
      nodeIds: ['a'],
    })
  })
})
