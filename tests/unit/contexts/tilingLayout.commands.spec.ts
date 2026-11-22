import { describe, expect, it } from 'vitest'
import type { TilingLayout } from '../../../src/shared/tiling/tilingLayout'
import {
  applyTilingCommand,
  type TilingCommand,
  type TilingCommandResult,
} from '../../../src/shared/tiling/tilingLayoutCommands'

function counter(prefix = 'n') {
  let next = 0
  return () => `${prefix}${(next += 1)}`
}

/** a | (b, c tabbed) side by side; weights 0.5 / 0.5. */
const layout: TilingLayout = {
  version: 1,
  root: {
    kind: 'split',
    id: 's1',
    direction: 'row',
    children: [
      { kind: 'group', id: 'g1', nodeIds: ['a'], activeNodeId: 'a' },
      { kind: 'group', id: 'g2', nodeIds: ['b', 'c'], activeNodeId: 'b' },
    ],
    weights: [0.5, 0.5],
  },
}

function apply(
  command: TilingCommand,
  options: { from?: TilingLayout | null; nodeIds?: string[] } = {},
): TilingCommandResult {
  return applyTilingCommand(options.from === undefined ? layout : options.from, command, {
    nodeIds: options.nodeIds ?? ['a', 'b', 'c'],
    createId: counter(),
  })
}

function rootOf(result: TilingCommandResult) {
  expect(result.kind).toBe('applied')
  return result.kind === 'applied' ? result.layout.root : null
}

describe('applyTilingCommand', () => {
  it('setWeights keeps the pair total and changes nothing else', () => {
    const root = rootOf(
      apply({ kind: 'setWeights', splitId: 's1', between: ['g1', 'g2'], weights: [1, 3] }),
    )
    expect(root?.kind === 'split' && root.weights).toEqual([0.25, 0.75])
  })

  it('setWeights is rejected when the neighbours were reordered or removed meanwhile (acceptance 5)', () => {
    expect(
      apply({ kind: 'setWeights', splitId: 's1', between: ['g2', 'g1'], weights: [1, 1] }).kind,
    ).toBe('rejected_stale_target')
    // Another client closed window a: g1 is gone and s1 collapsed into g2.
    expect(
      apply(
        { kind: 'setWeights', splitId: 's1', between: ['g1', 'g2'], weights: [1, 1] },
        { nodeIds: ['b', 'c'] },
      ).kind,
    ).toBe('rejected_stale_target')
  })

  it('setWeights with bad numbers is invalid', () => {
    expect(
      apply({ kind: 'setWeights', splitId: 's1', between: ['g1', 'g2'], weights: [0, 1] }).kind,
    ).toBe('rejected_invalid_command')
  })

  it('split moves a window into a new group beside, as a sibling in a same-direction split', () => {
    const root = rootOf(apply({ kind: 'split', groupId: 'g2', direction: 'row', nodeId: 'c' }))
    expect(root).toEqual({
      kind: 'split',
      id: 's1',
      direction: 'row',
      children: [
        { kind: 'group', id: 'g1', nodeIds: ['a'], activeNodeId: 'a' },
        { kind: 'group', id: 'g2', nodeIds: ['b'], activeNodeId: 'b' },
        { kind: 'group', id: 'n1', nodeIds: ['c'], activeNodeId: 'c' },
      ],
      weights: [0.5, 0.25, 0.25],
    })
  })

  it('split in the other direction wraps the group in a new split', () => {
    const root = rootOf(apply({ kind: 'split', groupId: 'g2', direction: 'column', nodeId: 'c' }))
    expect(root?.kind === 'split' && root.children[1]).toEqual({
      kind: 'split',
      id: 'n2',
      direction: 'column',
      children: [
        { kind: 'group', id: 'g2', nodeIds: ['b'], activeNodeId: 'b' },
        { kind: 'group', id: 'n1', nodeIds: ['c'], activeNodeId: 'c' },
      ],
      weights: [0.5, 0.5],
    })
  })

  it('split of a one-window group is invalid', () => {
    expect(apply({ kind: 'split', groupId: 'g1', direction: 'row', nodeId: 'a' }).kind).toBe(
      'rejected_invalid_command',
    )
  })

  it('moveWindow moves a tab into another group and activates it; an emptied group goes', () => {
    expect(rootOf(apply({ kind: 'moveWindow', nodeId: 'a', toGroupId: 'g2', index: 1 }))).toEqual({
      kind: 'group',
      id: 'g2',
      nodeIds: ['b', 'a', 'c'],
      activeNodeId: 'a',
    })
  })

  it('moveToEdge puts the window in a new group at that edge of the target', () => {
    const root = rootOf(apply({ kind: 'moveToEdge', nodeId: 'c', targetId: 'g1', edge: 'left' }))
    expect(root?.kind === 'split' && root.children.map(child => child.id)).toEqual([
      'n1',
      'g1',
      'g2',
    ])
  })

  it('moveToEdge of a lone window onto its own group changes nothing', () => {
    const result = apply({ kind: 'moveToEdge', nodeId: 'a', targetId: 'g1', edge: 'top' })
    expect(result).toMatchObject({ kind: 'applied', changed: false })
  })

  it('activate selects a tab, and is stale for a window that left the group', () => {
    expect(rootOf(apply({ kind: 'activate', groupId: 'g2', nodeId: 'c' }))).toMatchObject({
      children: [{ id: 'g1' }, { id: 'g2', activeNodeId: 'c' }],
    })
    expect(apply({ kind: 'activate', groupId: 'g2', nodeId: 'a' }).kind).toBe(
      'rejected_stale_target',
    )
  })

  it('toggleTabs turns a split into one tab group and back into side-by-side groups', () => {
    const merged = rootOf(apply({ kind: 'toggleTabs', targetId: 's1', activeNodeId: 'c' }))
    expect(merged).toEqual({ kind: 'group', id: 'n1', nodeIds: ['a', 'b', 'c'], activeNodeId: 'c' })
    const split = rootOf(
      apply({ kind: 'toggleTabs', targetId: 'n1' }, { from: { version: 1, root: merged } }),
    )
    expect(
      split?.kind === 'split' &&
        split.children.map(child => child.kind === 'group' && child.nodeIds),
    ).toEqual([['a'], ['b'], ['c']])
  })

  it('equalise resets the weights of a split', () => {
    const uneven: TilingLayout = {
      version: 1,
      root: {
        ...(layout.root as Extract<TilingLayout['root'], { kind: 'split' }>),
        weights: [0.9, 0.1],
      },
    }
    const root = rootOf(apply({ kind: 'equalise', splitId: 's1' }, { from: uneven }))
    expect(root?.kind === 'split' && root.weights).toEqual([0.5, 0.5])
  })

  it('placeNew puts a window that just arrived beside the focused group', () => {
    const root = rootOf(
      apply(
        { kind: 'placeNew', nodeId: 'd', nearGroupId: 'g1', placement: 'column' },
        { nodeIds: ['a', 'b', 'c', 'd'] },
      ),
    )
    expect(root?.kind === 'split' && root.children[0]).toMatchObject({
      kind: 'split',
      direction: 'column',
      children: [{ id: 'g1' }, { nodeIds: ['d'] }],
    })
  })

  it('placeNew leaves the window at the default destination when the focused group is gone', () => {
    const root = rootOf(
      apply(
        { kind: 'placeNew', nodeId: 'd', nearGroupId: 'gone', placement: 'tab' },
        { nodeIds: ['a', 'b', 'c', 'd'] },
      ),
    )
    expect(root?.kind === 'split' && root.children[1]).toMatchObject({
      id: 'g2',
      nodeIds: ['b', 'c', 'd'],
    })
  })

  it('placeNew for a window the Space does not have yet is stale', () => {
    expect(apply({ kind: 'placeNew', nodeId: 'd', nearGroupId: 'g1', placement: 'tab' }).kind).toBe(
      'rejected_stale_target',
    )
  })

  describe('the empty layout', () => {
    const empty: TilingLayout = { version: 1, root: null }

    it('accepts only placeNew, which gives a single root group', () => {
      expect(apply({ kind: 'equalise', splitId: 's1' }, { from: empty, nodeIds: [] }).kind).toBe(
        'rejected_stale_target',
      )
      expect(
        rootOf(
          apply(
            { kind: 'placeNew', nodeId: 'a', nearGroupId: 'gone', placement: 'row' },
            { from: empty, nodeIds: ['a'] },
          ),
        ),
      ).toEqual({ kind: 'group', id: 'n1', nodeIds: ['a'], activeNodeId: 'a' })
    })

    it('makes commands stale once the last window has left', () => {
      const one: TilingLayout = {
        version: 1,
        root: { kind: 'group', id: 'g1', nodeIds: ['a'], activeNodeId: 'a' },
      }
      // The layout is normalised against the Space's windows first; with none left it is empty.
      expect(
        apply({ kind: 'activate', groupId: 'g1', nodeId: 'a' }, { from: one, nodeIds: [] }).kind,
      ).toBe('rejected_stale_target')
    })
  })

  it('does not mutate its input', () => {
    const before = JSON.stringify(layout)
    apply({ kind: 'split', groupId: 'g2', direction: 'column', nodeId: 'c' })
    apply({ kind: 'moveToEdge', nodeId: 'a', targetId: 'g2', edge: 'bottom' })
    expect(JSON.stringify(layout)).toBe(before)
  })
})
