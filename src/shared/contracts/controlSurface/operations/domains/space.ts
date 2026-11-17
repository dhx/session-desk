import { normalizeGetSpacePayload, normalizeListSpacesPayload } from '../spaceQueriesNormalize'
import * as z from 'zod'
import { defineLegacyOperation, defineOperation } from '../defineOperation'
export const spaceCreateChildOperation = defineLegacyOperation({
  id: 'space.createChild',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Create a child space and move selected nodes into it',
})
// Session Desk (#30): plugins create a top-level Space and rename or recolour one.
export const spaceCreateOperation = defineLegacyOperation({
  id: 'space.create',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Create an empty top-level space',
})
export const spaceUpdateOperation = defineLegacyOperation({
  id: 'space.update',
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
  // Legacy isRecord accepts arrays; raw normalization retains named array properties.
  input: z.union([z.looseObject({ spaceId: z.string() }), z.array(z.unknown())]),
  normalize: normalizeGetSpacePayload,
  legacyNormalize: normalizeGetSpacePayload,
  errors: ['space.not_found', 'persistence.unavailable'],
})
export const spaceListOperation = defineOperation({
  id: 'space.list',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'List spaces and their nodes in the selected or active project',
  // Legacy isRecord accepts arrays; raw normalization retains named array properties.
  input: z
    .union([z.looseObject({ projectId: z.string().nullish() }), z.array(z.unknown())])
    .nullish(),
  normalize: normalizeListSpacesPayload,
  legacyNormalize: normalizeListSpacesPayload,
  errors: ['persistence.unavailable'],
})
export const spaceOperations = [
  spaceCreateChildOperation,
  spaceCreateOperation,
  spaceUpdateOperation,
  spaceGetOperation,
  spaceListOperation,
] as const
