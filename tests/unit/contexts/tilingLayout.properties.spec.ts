import { describe, expect, it } from 'vitest'
import {
  forEachTilingNode,
  listTilingGroups,
  listTilingWindowIds,
  type TilingLayout,
} from '../../../src/shared/tiling/tilingLayout'
import {
  applyTilingCommand,
  type TilingCommand,
} from '../../../src/shared/tiling/tilingLayoutCommands'
import { deriveInitialTilingLayout } from '../../../src/shared/tiling/tilingLayoutDerive'
import { normalizeTilingLayout } from '../../../src/shared/tiling/tilingLayoutNormalize'

/** Seeded PRNG (mulberry32), so a failing run can be replayed from its seed. */
function random(seed: number) {
  let state = seed >>> 0
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    int: (max: number) => Math.floor(next() * max),
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!,
  }
}

/**
 * A plain check instead of `expect`: the property test below makes several hundred thousand of
 * them, and `expect` made it take seconds, close to the test timeout on a loaded CI runner.
 */
function must(condition: boolean, context: string, what: string): void {
  if (!condition) {
    throw new Error(`${context}: ${what}`)
  }
}

/** Checks spec §2 invariant 1 and the structural rules of §4; returns every id in the layout. */
function expectValid(
  layout: TilingLayout,
  nodeIds: readonly string[],
  context: string,
): Set<string> {
  const windows = listTilingWindowIds(layout.root)
  const members = new Set(nodeIds)
  must(new Set(windows).size === windows.length, context, 'a window is placed twice')
  must(
    windows.length === members.size && windows.every(id => members.has(id)),
    context,
    `windows [${windows.join(', ')}] are not the members [${[...members].join(', ')}]`,
  )
  must((layout.root === null) === (nodeIds.length === 0), context, 'root does not match emptiness')
  const ids = new Set<string>()
  forEachTilingNode(layout.root, node => {
    must(!ids.has(node.id), context, `repeated id ${node.id}`)
    ids.add(node.id)
    if (node.kind === 'group') {
      must(node.nodeIds.length > 0, context, `group ${node.id} is empty`)
      must(
        node.nodeIds.includes(node.activeNodeId),
        context,
        `group ${node.id} has an active window that is not in it`,
      )
    } else {
      must(node.children.length >= 2, context, `split ${node.id} has fewer than two children`)
      must(
        node.weights.length === node.children.length,
        context,
        `split ${node.id} has ${node.weights.length} weights for ${node.children.length} children`,
      )
      must(
        node.weights.every(weight => weight > 0),
        context,
        `split ${node.id} has a weight that is not positive`,
      )
      must(
        Math.abs(node.weights.reduce((sum, weight) => sum + weight, 0) - 1) < 1e-9,
        context,
        `the weights of split ${node.id} do not sum to 1`,
      )
    }
  })
  return ids
}

function randomCommand(
  rng: ReturnType<typeof random>,
  layout: TilingLayout,
  nodeIds: string[],
): TilingCommand {
  const groups = listTilingGroups(layout.root)
  const splits: Array<{ id: string; childIds: string[] }> = []
  forEachTilingNode(layout.root, node => {
    if (node.kind === 'split') {
      splits.push({ id: node.id, childIds: node.children.map(child => child.id) })
    }
  })
  // Mostly real targets; sometimes ids that were never there, to exercise rejections.
  const anyId = () =>
    rng.next() < 0.1
      ? `ghost${rng.int(5)}`
      : rng.pick([...groups.map(g => g.id), ...splits.map(s => s.id), 'ghost'])
  const groupId = () =>
    rng.next() < 0.1 || groups.length === 0 ? `ghost${rng.int(5)}` : rng.pick(groups).id
  const windowId = () =>
    nodeIds.length === 0 || rng.next() < 0.1 ? `w${rng.int(30)}` : rng.pick(nodeIds)
  const splitId = () => (splits.length === 0 || rng.next() < 0.1 ? 'ghost' : rng.pick(splits).id)
  switch (rng.int(8)) {
    case 0: {
      const split = splits.length > 0 ? rng.pick(splits) : { id: 'ghost', childIds: ['x', 'y'] }
      const index = rng.int(Math.max(1, split.childIds.length - 1))
      return {
        kind: 'setWeights',
        splitId: split.id,
        between: [split.childIds[index] ?? 'x', split.childIds[index + 1] ?? 'y'],
        weights: [rng.next() + 0.01, rng.next() + 0.01],
      }
    }
    case 1:
      return {
        kind: 'split',
        groupId: groupId(),
        direction: rng.pick(['row', 'column']),
        nodeId: windowId(),
      }
    case 2:
      return { kind: 'moveWindow', nodeId: windowId(), toGroupId: groupId(), index: rng.int(4) }
    case 3:
      return {
        kind: 'moveToEdge',
        nodeId: windowId(),
        targetId: anyId(),
        edge: rng.pick(['top', 'right', 'bottom', 'left']),
      }
    case 4:
      return { kind: 'activate', groupId: groupId(), nodeId: windowId() }
    case 5:
      return { kind: 'toggleTabs', targetId: anyId() }
    case 6:
      return { kind: 'equalise', splitId: splitId() }
    default:
      return {
        kind: 'placeNew',
        nodeId: windowId(),
        nearGroupId: groupId(),
        placement: rng.pick(['tab', 'row', 'column']),
      }
  }
}

describe('tiling layout properties', () => {
  it('stays valid, keeps surviving ids and never reuses one, over random commands and membership changes', () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const rng = random(seed)
      let created = 0
      const createId = () => `id${seed}_${(created += 1)}`
      let nextWindow = 0
      let nodeIds = Array.from({ length: rng.int(6) }, () => `w${(nextWindow += 1)}`)
      let layout = deriveInitialTilingLayout(
        nodeIds.map(id => ({ id, x: rng.int(2000), y: rng.int(2000) })),
        createId,
      )
      const everSeen = expectValid(layout, nodeIds, `seed ${seed} derive`)

      for (let step = 0; step < 60; step += 1) {
        const context = `seed ${seed} step ${step}`
        const roll = rng.next()
        if (roll < 0.15) {
          nodeIds = [...nodeIds, `w${(nextWindow += 1)}`]
        } else if (roll < 0.25 && nodeIds.length > 0) {
          const gone = rng.pick(nodeIds)
          nodeIds = nodeIds.filter(id => id !== gone)
        }
        const before = normalizeTilingLayout(layout, nodeIds, createId)
        const beforeIds = expectValid(before, nodeIds, `${context} membership`)
        const command = randomCommand(rng, before, nodeIds)
        const result = applyTilingCommand(before, command, { nodeIds, createId })
        if (result.kind !== 'applied') {
          continue
        }
        const afterIds = expectValid(result.layout, nodeIds, `${context} ${command.kind}`)
        for (const id of afterIds) {
          // An id is either one that was there just before, or brand new: never a removed one back.
          if (!beforeIds.has(id)) {
            must(!everSeen.has(id), context, `reused id ${id}`)
          }
          everSeen.add(id)
        }
        for (const id of beforeIds) {
          everSeen.add(id)
        }
        layout = result.layout
      }
    }
  })

  it('always rejects setWeights whose pair is not two adjacent children in order', () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const rng = random(seed)
      let created = 0
      const createId = () => `id${(created += 1)}`
      const nodeIds = Array.from({ length: 2 + rng.int(8) }, (_, index) => `w${index}`)
      const layout = deriveInitialTilingLayout(
        nodeIds.map(id => ({ id, x: rng.int(2000), y: rng.int(2000) })),
        createId,
      )
      forEachTilingNode(layout.root, split => {
        if (split.kind !== 'split') {
          return
        }
        const childIds = split.children.map(child => child.id)
        for (let left = 0; left < childIds.length; left += 1) {
          for (let right = 0; right < childIds.length; right += 1) {
            const result = applyTilingCommand(
              layout,
              {
                kind: 'setWeights',
                splitId: split.id,
                between: [childIds[left]!, childIds[right]!],
                weights: [1, 2],
              },
              { nodeIds, createId },
            )
            expect(result.kind, `seed ${seed} ${left}->${right}`).toBe(
              right === left + 1 ? 'applied' : 'rejected_stale_target',
            )
          }
        }
      })
    }
  })
})
