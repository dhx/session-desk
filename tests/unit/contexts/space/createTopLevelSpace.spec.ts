import { describe, expect, it } from 'vitest'
import {
  createTopLevelSpace,
  resolveEmptySpaceSize,
  updateSpaceAttributes,
} from '../../../../src/contexts/space/application/createTopLevelSpace'
import type { ChildSpaceRecord } from '../../../../src/contexts/space/application/createChildSpace'
import { SPACE_MIN_SIZE } from '../../../../src/contexts/workspace/domain/workspaceSpaceLayout'

function space(id: string, name: string, rect: ChildSpaceRecord['rect']): ChildSpaceRecord {
  return {
    id,
    name,
    directoryPath: '/repo',
    targetMountId: 'mount-1',
    parentSpaceId: null,
    sortOrder: 0,
    labelColor: null,
    nodeIds: [],
    rect,
  }
}

function overlaps(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

const size = { width: 600, height: 400 }
const base = {
  targetMountId: 'mount-1',
  directoryPath: '/repo',
  size,
  createId: () => 'new-space',
}

describe('createTopLevelSpace', () => {
  it('places the new Space beside existing content without overlapping it', () => {
    const existing = [space('a', 'Alpha', { x: 0, y: 0, width: 800, height: 600 })]
    const nodeFrames = [{ id: 'n', x: 900, y: 100, width: 300, height: 200 }]
    const result = createTopLevelSpace({
      ...base,
      spaces: existing,
      nodeFrames,
      name: 'Client portal',
      labelColor: 'blue',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.space).toMatchObject({
      id: 'new-space',
      name: 'Client portal',
      labelColor: 'blue',
      parentSpaceId: null,
      targetMountId: 'mount-1',
      directoryPath: '/repo',
      nodeIds: [],
      sortOrder: 1,
    })
    expect(result.space.rect).toMatchObject(size)
    expect(overlaps(result.space.rect!, existing[0].rect!)).toBe(false)
    expect(overlaps(result.space.rect!, nodeFrames[0])).toBe(false)
    expect(result.nextSpaces.map(item => item.id)).toEqual(['a', 'new-space'])
  })

  it('starts at the origin on an empty canvas', () => {
    const result = createTopLevelSpace({
      ...base,
      spaces: [],
      nodeFrames: [],
      name: 'First',
      labelColor: null,
    })
    expect(result.ok && result.space.rect).toEqual({ x: 0, y: 0, ...size })
  })

  it('refuses an empty name and a name the project already uses, in any case', () => {
    const existing = [space('a', 'Alpha', null)]
    expect(
      createTopLevelSpace({
        ...base,
        spaces: existing,
        nodeFrames: [],
        name: '  ',
        labelColor: null,
      }),
    ).toEqual({ ok: false, code: 'name_required' })
    expect(
      createTopLevelSpace({
        ...base,
        spaces: existing,
        nodeFrames: [],
        name: ' alpha ',
        labelColor: null,
      }),
    ).toEqual({ ok: false, code: 'name_taken' })
  })

  it('sizes an empty Space for one Agent window, never below the minimum', () => {
    expect(resolveEmptySpaceSize({ width: 10, height: 10 })).toEqual(SPACE_MIN_SIZE)
    const large = resolveEmptySpaceSize({ width: 2000, height: 1500 })
    expect(large.width).toBeGreaterThan(2000)
    expect(large.height).toBeGreaterThan(1500)
  })
})

describe('updateSpaceAttributes', () => {
  const spaces = [space('a', 'Alpha', null), space('b', 'Beta', null)]

  it('renames and recolours one Space and leaves the others alone', () => {
    const result = updateSpaceAttributes(spaces, { spaceId: 'a', name: 'Gamma', labelColor: 'red' })
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.space).toMatchObject({ id: 'a', name: 'Gamma', labelColor: 'red' })
    expect(result.nextSpaces[1]).toBe(spaces[1])
  })

  it('clears the colour with null and keeps it when left out', () => {
    const coloured = [{ ...spaces[0], labelColor: 'green' as const }]
    const kept = updateSpaceAttributes(coloured, { spaceId: 'a', name: 'Alpha 2' })
    expect(kept.ok && kept.space.labelColor).toBe('green')
    const cleared = updateSpaceAttributes(coloured, { spaceId: 'a', labelColor: null })
    expect(cleared.ok && cleared.space.labelColor).toBeNull()
  })

  it('keeps a Space its own name in another case, and refuses another Space name', () => {
    expect(updateSpaceAttributes(spaces, { spaceId: 'a', name: 'ALPHA' }).ok).toBe(true)
    expect(updateSpaceAttributes(spaces, { spaceId: 'a', name: 'beta' })).toEqual({
      ok: false,
      code: 'name_taken',
    })
    expect(updateSpaceAttributes(spaces, { spaceId: 'x', name: 'New' })).toEqual({
      ok: false,
      code: 'not_found',
    })
    expect(updateSpaceAttributes(spaces, { spaceId: 'a', name: '' })).toEqual({
      ok: false,
      code: 'name_required',
    })
  })
})
