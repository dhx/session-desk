import type { TilingLayout } from './tilingLayout'
import type { TilingCommand } from './tilingLayoutCommands'

export interface StoredTilingLayout {
  layout: TilingLayout
  layoutRevision: number
}

/** `resetLayout` replaces the layout with a freshly derived one; the reducer never sees it. */
export type TilingStoreCommand = TilingCommand | { kind: 'resetLayout' }

export type TilingStoreCommandResult =
  | ({ kind: 'applied'; changed: boolean } & StoredTilingLayout)
  | ({ kind: 'rejected_stale_target'; reason: string } & StoredTilingLayout)
  | { kind: 'rejected_invalid_command'; reason: string }

/** One committed change to a stored layout; told to listeners after the transaction. */
export interface TilingLayoutCommitted {
  /** The app state revision at the time of the commit. */
  revision: number
  spaceId: string
  layoutRevision: number
  /** The command's id; `null` for a first materialisation or a membership normalisation. */
  operationId: string | null
}

/**
 * The stored layout of each Space (docs/canvas/TILING_VIEW_SPEC.md §3). There is no way to write
 * a tree: a layout changes by a command, a reset, or the store's own membership normalisation
 * when a snapshot write changes a Space's windows.
 */
export interface TilingLayoutStore {
  /** Returns the layout, deriving and storing the first one if none exists. `null`: no such Space. */
  read(spaceId: string): Promise<StoredTilingLayout | null>
  /** Applies one command against the current layout. `null`: no such Space. */
  apply(input: {
    spaceId: string
    operationId: string
    command: TilingStoreCommand
  }): Promise<TilingStoreCommandResult | null>
  onCommitted(listener: (event: TilingLayoutCommitted) => void): () => void
}
