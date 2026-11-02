import type { PluginHostAuthority } from '../../../../contexts/plugins/domain/pluginHostTypes'
import {
  pluginRecord,
  pluginString,
} from '../../../../contexts/plugins/domain/localPluginValidation'
import type { PersistenceStore } from '../../../../platform/persistence/sqlite/PersistenceStore'
import type { GetSpaceResult, ListSpacesResult } from '../../../../shared/contracts/dto'
import { createAppError } from '../../../../shared/errors/appError'
import type { ControlSurface } from '../controlSurface'
import type { ControlSurfaceContext } from '../types'
import { listPluginTargets } from './pluginTargetResolution'

function fields(value: unknown, allowed: readonly string[]) {
  const input = pluginRecord(value)
  if (Object.keys(input).some(key => !allowed.includes(key))) {
    throw new Error('Unsupported plugin Space argument.')
  }
  return input
}

/**
 * Lists, creates and renames Spaces for plugins through the Space owner's commands. There is
 * no delete: a Space holds the person's windows, and removing it stays their decision.
 */
export function createPluginSpaceHost(
  control: ControlSurface,
  deps: {
    getPersistenceStore(): Promise<PersistenceStore>
    context: ControlSurfaceContext
  },
) {
  async function invoke<T>(
    authority: PluginHostAuthority,
    id: string,
    kind: 'query' | 'command',
    payload: unknown,
  ): Promise<T> {
    authority.assertActive()
    const result = await control.invoke(
      { ...deps.context, assertActive: authority.assertActive },
      { id, kind, payload },
    )
    if (!result.ok) {
      throw new Error(result.error.debugMessage ?? createAppError(result.error).message)
    }
    authority.assertActive()
    return result.value as T
  }
  async function requireProject(authority: PluginHostAuthority, projectId: string) {
    const known = (await listPluginTargets(deps)).projects.some(item => item.id === projectId)
    authority.assertActive()
    if (!known) {
      throw new Error('Project is unavailable.')
    }
  }
  async function request(
    authority: PluginHostAuthority,
    operation: string,
    payload: unknown,
  ): Promise<unknown> {
    authority.assertActive()
    if (operation === 'spaces.list') {
      const input = fields(payload, ['projectId'])
      const projectId = pluginString(input.projectId, 'projectId', 200)
      await requireProject(authority, projectId)
      const result = await invoke<ListSpacesResult>(authority, 'space.list', 'query', {
        projectId,
      })
      return {
        projectId,
        spaces: result.spaces.map(space => ({
          id: space.id,
          name: space.name,
          labelColor: space.labelColor,
          directoryPath: space.directoryPath,
          parentSpaceId: space.parentSpaceId,
        })),
      }
    }
    if (operation === 'spaces.create') {
      const input = fields(payload, ['projectId', 'name', 'labelColor', 'directoryPath'])
      await requireProject(authority, pluginString(input.projectId, 'projectId', 200))
      return invoke(authority, 'space.create', 'command', input)
    }
    if (operation === 'spaces.update') {
      const input = fields(payload, ['spaceId', 'name', 'labelColor'])
      const spaceId = pluginString(input.spaceId, 'spaceId', 200)
      const { projectId } = await invoke<GetSpaceResult>(authority, 'space.get', 'query', {
        spaceId,
      })
      await requireProject(authority, projectId)
      return invoke(authority, 'space.update', 'command', input)
    }
    throw new Error('Unsupported plugin Space operation.')
  }
  return {
    handles: (operation: string) => operation.startsWith('spaces.'),
    request,
  }
}
