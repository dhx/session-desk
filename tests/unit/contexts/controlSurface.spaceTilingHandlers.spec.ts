import { expect, it, vi } from 'vitest'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { registerSpaceTilingHandlers } from '../../../src/app/main/controlSurface/handlers/spaceTilingHandlers'
import { sessionGrantRule } from '../../../src/app/main/controlSurface/http/sessionGrantPolicy'
import type { ControlSurfaceContext } from '../../../src/app/main/controlSurface/types'
import { createAppError } from '../../../src/shared/errors/appError'
import type {
  TilingLayoutStore,
  TilingStoreCommandResult,
} from '../../../src/shared/tiling/TilingLayoutStore'
import type { PersistenceStore } from '../../../src/platform/persistence/sqlite/PersistenceStore'

const ctx = {
  now: () => new Date('2026-11-22T00:00:00.000Z'),
  capabilities: {},
} as unknown as ControlSurfaceContext

const layout = {
  version: 1 as const,
  root: { kind: 'group' as const, id: 'group-1', nodeIds: ['a'], activeNodeId: 'a' },
}

function setup(layouts: Partial<TilingLayoutStore> | null) {
  const controlSurface = createControlSurface()
  registerSpaceTilingHandlers(
    controlSurface,
    async () => (layouts ? { tilingLayouts: layouts } : {}) as unknown as PersistenceStore,
  )
  return {
    read: (payload: unknown) =>
      controlSurface.invoke(ctx, { kind: 'query', id: 'space.readTilingLayout', payload }),
    apply: (payload: unknown) =>
      controlSurface.invoke(ctx, { kind: 'command', id: 'space.applyTilingCommand', payload }),
  }
}

const applyPayload = (command: unknown) => ({
  spaceId: 'space-1',
  baseLayoutRevision: 1,
  operationId: 'op-1',
  command,
})

it('reads a layout and reports a Space that does not exist', async () => {
  const read = vi.fn(async (spaceId: string) =>
    spaceId === 'space-1' ? { layout, layoutRevision: 4 } : null,
  )
  const surface = setup({ read })
  expect(await surface.read({ spaceId: 'space-1' })).toMatchObject({
    ok: true,
    value: { status: 'ok', layout, layoutRevision: 4 },
  })
  expect(await surface.read({ spaceId: 'gone' })).toMatchObject({
    ok: true,
    value: { status: 'space_not_found' },
  })
  expect(await surface.read({})).toMatchObject({
    ok: false,
    error: { code: 'common.invalid_input' },
  })
})

it('passes a command on without comparing the base revision and maps every outcome', async () => {
  const outcomes: Array<TilingStoreCommandResult | null> = [
    { kind: 'applied', changed: true, layout, layoutRevision: 9 },
    {
      kind: 'rejected_stale_target',
      reason: 'the split no longer exists',
      layout,
      layoutRevision: 9,
    },
    { kind: 'rejected_invalid_command', reason: 'weights must be positive' },
    null,
  ]
  const apply = vi.fn(async () => outcomes.shift() ?? null)
  const surface = setup({ apply })
  const command = { kind: 'equalise', splitId: 'split-1' }
  expect(await surface.apply(applyPayload(command))).toMatchObject({
    ok: true,
    value: { status: 'applied', changed: true, layout, layoutRevision: 9 },
  })
  expect(apply).toHaveBeenCalledWith({ spaceId: 'space-1', operationId: 'op-1', command })
  expect(await surface.apply(applyPayload({ kind: 'resetLayout' }))).toMatchObject({
    ok: true,
    value: {
      status: 'rejected_stale_target',
      reason: 'the split no longer exists',
      layout,
      layoutRevision: 9,
    },
  })
  expect(await surface.apply(applyPayload(command))).toMatchObject({
    ok: true,
    value: { status: 'rejected_invalid_command', reason: 'weights must be positive' },
  })
  expect(await surface.apply(applyPayload(command))).toMatchObject({
    ok: true,
    value: { status: 'space_not_found' },
  })
})

it('refuses a whole tree, an unknown command and a missing operation id', async () => {
  const apply = vi.fn()
  const surface = setup({ apply })
  for (const payload of [
    applyPayload({ kind: 'replaceLayout', layout }),
    { ...applyPayload({ kind: 'resetLayout' }), layout },
    { ...applyPayload({ kind: 'resetLayout' }), operationId: '' },
    { ...applyPayload({ kind: 'resetLayout' }), baseLayoutRevision: -1 },
    applyPayload({ kind: 'split', groupId: 'g', direction: 'diagonal', nodeId: 'a' }),
  ]) {
    // eslint-disable-next-line no-await-in-loop
    const result = await surface.apply(payload)
    if (result.ok) {
      // An unknown extra key is dropped by the schema; it must never reach the store.
      expect(apply.mock.calls.at(-1)?.[0]).not.toHaveProperty('layout')
    } else {
      expect(result.error.code).toBe('common.invalid_input')
    }
  }
  expect(apply).toHaveBeenCalledTimes(1)
})

it('reports unavailable persistence when the store keeps no layouts', async () => {
  const surface = setup(null)
  expect(await surface.read({ spaceId: 'space-1' })).toMatchObject({
    ok: false,
    error: { code: 'persistence.unavailable' },
  })
})

it('lets an agent session read and arrange the layout, like space.update', () => {
  expect(sessionGrantRule('space.readTilingLayout')).toEqual({ access: 'allow' })
  expect(sessionGrantRule('space.applyTilingCommand')).toEqual({ access: 'allow' })
})

it('checks that the caller is still active after waiting for the store, before any write', async () => {
  const read = vi.fn(async () => ({ layout, layoutRevision: 1 }))
  const apply = vi.fn(async () => null)
  const controlSurface = createControlSurface()
  let active = true
  registerSpaceTilingHandlers(controlSurface, async () => {
    // The credential is revoked while the handler waits for the store.
    active = false
    return { tilingLayouts: { read, apply } } as unknown as PersistenceStore
  })
  const revocable = {
    ...ctx,
    assertActive: () => {
      if (!active) {
        throw createAppError('worker.unavailable')
      }
    },
  } as ControlSurfaceContext
  const readResult = await controlSurface.invoke(revocable, {
    kind: 'query',
    id: 'space.readTilingLayout',
    payload: { spaceId: 'space-1' },
  })
  active = true
  const applyResult = await controlSurface.invoke(revocable, {
    kind: 'command',
    id: 'space.applyTilingCommand',
    payload: applyPayload({ kind: 'resetLayout' }),
  })
  expect(readResult).toMatchObject({ ok: false, error: { code: 'worker.unavailable' } })
  expect(applyResult).toMatchObject({ ok: false, error: { code: 'worker.unavailable' } })
  expect(read).not.toHaveBeenCalled()
  expect(apply).not.toHaveBeenCalled()
})
