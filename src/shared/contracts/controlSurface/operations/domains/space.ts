import * as z from 'zod'
import type { TilingCommandDto } from '../../../dto/tiling'
import { spaceUpdateInput, normalizeSpaceUpdateInput } from '../spaceUpdateInput'
import { normalizeBootstrapInput } from '../workspaceBootstrapNormalize'
import { defineLegacyOperation, defineOperation } from '../defineOperation'
import { normalizeCreateChildPayload } from '../spaceCreateChildNormalize'
import { normalizeGetSpacePayload, normalizeListSpacesPayload } from '../spaceQueriesNormalize'
export const spaceCreateChildOperation = defineOperation({
  input: z.union([
    z.object({
      parentSpaceId: z.string().describe('Parent space identifier'),
      projectId: z
        .string()
        .nullish()
        .describe('Owning project identifier; omit to resolve from parent'),
      name: z.string().nullish().describe('Child space name'),
      initialNodeIds: z
        .array(z.string())
        .nullish()
        .describe('Node identifiers to move into the child'),
      rect: z
        .object({
          x: z.number().describe('Horizontal canvas position'),
          y: z.number().describe('Vertical canvas position'),
          width: z.number().describe('Positive boundary width'),
          height: z.number().describe('Positive boundary height'),
        })
        .or(z.array(z.unknown()))
        .nullish()
        .describe('Child boundary with positive width and height'),
      anchor: z
        .object({
          x: z.number().describe('Horizontal anchor position'),
          y: z.number().describe('Vertical anchor position'),
        })
        .or(z.array(z.unknown()))
        .nullish()
        .describe('Child anchor position'),
    }),
    z.array(z.unknown()),
  ]),
  normalize: normalizeCreateChildPayload,
  compat: 'control-surface-legacy-validation',
  legacyNormalize: normalizeCreateChildPayload,
  errors: [
    'space.not_found',
    'persistence.invalid_state',
    'persistence.unavailable',
    'persistence.io_failed',
  ],
  id: 'space.createChild',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Create a child space and move selected nodes into it',
})
// Session Desk (#30): plugins create an empty top-level Space beside the canvas content, and
// rename or recolour one (host.spaces.create/update). Fork ids, apart from upstream's space.create.
export const spaceCreateEmptyOperation = defineLegacyOperation({
  compat: 'control-surface-legacy-validation',
  id: 'space.createEmpty',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Create an empty top-level space beside the canvas content',
})
export const spaceSetAttributesOperation = defineLegacyOperation({
  compat: 'control-surface-legacy-validation',
  id: 'space.setAttributes',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Rename or recolour a space',
})
export const spaceGetOperation = defineOperation({
  id: 'space.get',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Get a space with its nodes and owning project',
  // @compat control-surface-legacy-validation
  // Legacy isRecord accepts arrays; raw normalization retains named array properties.
  input: z.union([z.looseObject({ spaceId: z.string() }), z.array(z.unknown())]),
  normalize: normalizeGetSpacePayload,
  compat: 'control-surface-legacy-validation',
  legacyNormalize: normalizeGetSpacePayload,
  errors: ['space.not_found', 'persistence.unavailable'],
})
export const spaceListOperation = defineOperation({
  id: 'space.list',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'List spaces and their nodes in the selected or active project',
  // @compat control-surface-legacy-validation
  // Legacy isRecord accepts arrays; raw normalization retains named array properties.
  input: z
    .union([z.looseObject({ projectId: z.string().nullish() }), z.array(z.unknown())])
    .nullish(),
  normalize: normalizeListSpacesPayload,
  compat: 'control-surface-legacy-validation',
  legacyNormalize: normalizeListSpacesPayload,
  errors: ['persistence.unavailable'],
})

export const spaceCreateOperation = defineOperation({
  id: 'space.create',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Create a top-level space bound to the project default mount',
  input: z.object({
    projectId: z.string(),
    name: z.string(),
    directoryPath: z.string().optional(),
  }),
  normalize: input => normalizeBootstrapInput(input),
  errors: ['persistence.invalid_state', 'persistence.io_failed', 'persistence.unavailable'],
})

export const spaceUpdateOperation = defineOperation({
  id: 'space.update',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Rename a space or adjust its boundary around fixed contents',
  input: spaceUpdateInput,
  normalize: normalizeSpaceUpdateInput,
  errors: [
    'space.not_found',
    'persistence.invalid_state',
    'persistence.io_failed',
    'persistence.unavailable',
    'persistence.payload_too_large',
  ],
})

// The tiling layout of a Space (docs/canvas/TILING_VIEW_SPEC.md §3). There is no operation that
// writes a tree: the Worker owns it and changes it by one command at a time.
const tilingDirection = z.enum(['row', 'column'])
const tilingCommand: z.ZodType<TilingCommandDto> = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('setWeights'),
    splitId: z.string(),
    between: z.tuple([z.string(), z.string()]),
    weights: z.tuple([z.number(), z.number()]),
  }),
  z.object({
    kind: z.literal('split'),
    groupId: z.string(),
    direction: tilingDirection,
    nodeId: z.string(),
  }),
  z.object({
    kind: z.literal('moveWindow'),
    nodeId: z.string(),
    toGroupId: z.string(),
    index: z.number().int().optional(),
  }),
  z.object({
    kind: z.literal('moveToEdge'),
    nodeId: z.string(),
    targetId: z.string(),
    edge: z.enum(['top', 'right', 'bottom', 'left']),
  }),
  z.object({ kind: z.literal('activate'), groupId: z.string(), nodeId: z.string() }),
  z.object({
    kind: z.literal('toggleTabs'),
    targetId: z.string(),
    activeNodeId: z.string().optional(),
  }),
  z.object({ kind: z.literal('equalise'), splitId: z.string() }),
  z.object({
    kind: z.literal('placeNew'),
    nodeId: z.string(),
    nearGroupId: z.string(),
    placement: z.enum(['tab', 'row', 'column']),
  }),
  z.object({ kind: z.literal('resetLayout') }),
])

export const spaceReadTilingLayoutOperation = defineOperation({
  id: 'space.readTilingLayout',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Read the tiling layout of a space, deriving the first one from the canvas',
  input: z.object({ spaceId: z.string().min(1) }),
  errors: ['persistence.unavailable', 'persistence.io_failed'],
})

export const spaceApplyTilingCommandOperation = defineOperation({
  id: 'space.applyTilingCommand',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Apply one command to the tiling layout of a space',
  input: z.object({
    spaceId: z.string().min(1),
    baseLayoutRevision: z
      .number()
      .int()
      .min(0)
      .describe('The layout revision the client saw; informative, never a reason to reject'),
    operationId: z
      .string()
      .min(1)
      .max(128)
      .describe('Chosen by the client; returned in the tiling.layout_updated event'),
    command: tilingCommand,
  }),
  errors: ['persistence.unavailable', 'persistence.io_failed'],
})

export const spaceOperations = [
  spaceUpdateOperation,
  spaceReadTilingLayoutOperation,
  spaceApplyTilingCommandOperation,
  spaceCreateOperation,
  spaceCreateChildOperation,
  spaceCreateEmptyOperation,
  spaceSetAttributesOperation,
  spaceGetOperation,
  spaceListOperation,
] as const
