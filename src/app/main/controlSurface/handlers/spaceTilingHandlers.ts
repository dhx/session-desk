import type { PersistenceStore } from '../../../../platform/persistence/sqlite/PersistenceStore'
import {
  spaceApplyTilingCommandOperation,
  spaceReadTilingLayoutOperation,
} from '../../../../shared/contracts/controlSurface/operations/domains/space'
import type {
  ApplyTilingCommandResult,
  ReadTilingLayoutResult,
} from '../../../../shared/contracts/dto'
import { createAppError } from '../../../../shared/errors/appError'
import type { ControlSurface } from '../controlSurface'
import { registerOperation } from '../registerOperation'
import type { ControlSurfaceContext } from '../types'

/**
 * The tiling layout of a Space (docs/canvas/TILING_VIEW_SPEC.md §3). The store announces each
 * committed change itself; the sync stream carries it as `tiling.layout_updated`.
 */
export function registerSpaceTilingHandlers(
  controlSurface: ControlSurface,
  getPersistenceStore: () => Promise<PersistenceStore>,
): void {
  // Both operations can write (a read stores the first layout), and the store enters its
  // transaction synchronously when called. So the caller is checked after the last await: a
  // credential revoked while the handler waited for the store commits nothing.
  const getLayouts = async (ctx: ControlSurfaceContext) => {
    const layouts = (await getPersistenceStore()).tilingLayouts
    if (!layouts) {
      throw createAppError('persistence.unavailable')
    }
    ctx.assertActive?.()
    return layouts
  }

  registerOperation(controlSurface, spaceReadTilingLayoutOperation, {
    handle: async (ctx, input): Promise<ReadTilingLayoutResult> => {
      const layouts = await getLayouts(ctx)
      const stored = await layouts.read(input.spaceId)
      return stored ? { status: 'ok', ...stored } : { status: 'space_not_found' }
    },
    defaultErrorCode: 'common.unexpected',
  })

  registerOperation(controlSurface, spaceApplyTilingCommandOperation, {
    // `baseLayoutRevision` is not compared: a command names its targets, and the store checks
    // those against the layout as it is now (spec §3.2).
    handle: async (ctx, input): Promise<ApplyTilingCommandResult> => {
      const layouts = await getLayouts(ctx)
      const result = await layouts.apply({
        spaceId: input.spaceId,
        operationId: input.operationId,
        command: input.command,
      })
      if (!result) {
        return { status: 'space_not_found' }
      }
      const { kind, ...rest } = result
      return { status: kind, ...rest } as ApplyTilingCommandResult
    },
    defaultErrorCode: 'common.unexpected',
  })
}
