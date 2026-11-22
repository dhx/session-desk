// The tiling layout of a Space on the wire (docs/canvas/TILING_VIEW_SPEC.md §3, §4). The Worker
// owns the tree: clients read it and send one command at a time, never a whole tree.

export type TilingSplitDirectionDto = 'row' | 'column'

export interface TilingSplitDto {
  kind: 'split'
  id: string
  direction: TilingSplitDirectionDto
  children: TilingNodeDto[]
  weights: number[]
}

export interface TilingGroupDto {
  kind: 'group'
  id: string
  nodeIds: string[]
  activeNodeId: string
}

export type TilingNodeDto = TilingSplitDto | TilingGroupDto

export interface TilingLayoutDto {
  version: 1
  /** `null`: the Space has no windows. */
  root: TilingNodeDto | null
}

export type TilingCommandDto =
  | { kind: 'setWeights'; splitId: string; between: [string, string]; weights: [number, number] }
  | { kind: 'split'; groupId: string; direction: TilingSplitDirectionDto; nodeId: string }
  | { kind: 'moveWindow'; nodeId: string; toGroupId: string; index?: number }
  | {
      kind: 'moveToEdge'
      nodeId: string
      targetId: string
      edge: 'top' | 'right' | 'bottom' | 'left'
    }
  | { kind: 'activate'; groupId: string; nodeId: string }
  | { kind: 'toggleTabs'; targetId: string; activeNodeId?: string }
  | { kind: 'equalise'; splitId: string }
  | {
      kind: 'placeNew'
      nodeId: string
      nearGroupId: string
      placement: 'tab' | TilingSplitDirectionDto
    }
  | { kind: 'resetLayout' }

export type ReadTilingLayoutResult =
  | { status: 'ok'; layout: TilingLayoutDto; layoutRevision: number }
  | { status: 'space_not_found' }

export type ApplyTilingCommandResult =
  /** `changed` is false when a valid command left the layout as it was. */
  | { status: 'applied'; changed: boolean; layout: TilingLayoutDto; layoutRevision: number }
  /** A target is gone or changed its role; `layout` is what the Space has now. */
  | {
      status: 'rejected_stale_target'
      reason: string
      layout: TilingLayoutDto
      layoutRevision: number
    }
  /** The command can never apply, whatever the layout. */
  | { status: 'rejected_invalid_command'; reason: string }
  | { status: 'space_not_found' }
