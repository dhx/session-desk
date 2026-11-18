// Session Desk (#30): plugins create an empty top-level Space and rename or recolour one.
import type { LabelColor } from '../../types/labelColor'

/** A top-level Space for a caller without a canvas view; placed beside existing content. */
export interface CreateSpaceInput {
  projectId: string
  name: string
  labelColor?: LabelColor | null
  directoryPath?: string | null
}

export interface SpaceAttributesDto {
  id: string
  name: string
  labelColor: LabelColor | null
  directoryPath: string
  targetMountId: string | null
  parentSpaceId: string | null
  rect: { x: number; y: number; width: number; height: number } | null
}

export interface CreateSpaceResult {
  revision: number
  projectId: string
  space: SpaceAttributesDto
}

/** Renames or recolours a Space. `labelColor: null` clears the colour; omitted fields stay. */
export interface UpdateSpaceInput {
  spaceId: string
  name?: string
  labelColor?: LabelColor | null
}

export interface UpdateSpaceResult {
  revision: number
  projectId: string
  space: SpaceAttributesDto
}
