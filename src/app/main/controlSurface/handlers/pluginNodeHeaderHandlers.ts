import type { PluginInstallationManager } from '@contexts/plugins/application/PluginInstallationManager'
import { pluginRecord, pluginString } from '@contexts/plugins/domain/localPluginValidation'
import { normalizePluginNodeHeaderState } from '@contexts/plugins/domain/pluginNodeHeader'
import { normalizePersistedAppState } from '../../../../platform/persistence/sqlite/normalize'
import type { PersistenceStore } from '../../../../platform/persistence/sqlite/PersistenceStore'
import { createAppError } from '../../../../shared/errors/appError'
import type { ControlSurface } from '../controlSurface'

const FIELDS = [
  'pluginId',
  'buttonId',
  'projectId',
  'expectedRevision',
  'expectedRuntimeGeneration',
]

/** Asks a plugin which windows of a project its header button links, and where to. */
export function registerPluginNodeHeaderHandlers(
  control: ControlSurface,
  deps: { plugins: PluginInstallationManager; getPersistenceStore(): Promise<PersistenceStore> },
): void {
  const fail = (cause: unknown): never => {
    const reason = (cause instanceof Error ? cause.message : String(cause)).slice(0, 2000)
    throw createAppError('plugin.operation_failed', { params: { reason }, debugMessage: reason })
  }
  control.register('plugin.nodeHeader.state', {
    kind: 'query',
    validate: value => {
      const raw = pluginRecord(value)
      if (Object.keys(raw).some(key => !FIELDS.includes(key))) {
        throw new Error('Invalid plugin window header request.')
      }
      if (!Number.isSafeInteger(raw.expectedRuntimeGeneration)) {
        throw new Error('Plugin generation is required.')
      }
      return {
        pluginId: pluginString(raw.pluginId, 'id', 80),
        buttonId: pluginString(raw.buttonId, 'buttonId', 80),
        projectId: pluginString(raw.projectId, 'projectId', 200),
        expectedRevision: pluginString(raw.expectedRevision, 'revision', 200),
        expectedRuntimeGeneration: raw.expectedRuntimeGeneration as number,
      }
    },
    handle: async (_ctx, input) => {
      try {
        const current = async () => {
          const plugin = (await deps.plugins.list()).find(item => item.id === input.pluginId)
          if (
            !plugin ||
            plugin.enabled === false ||
            plugin.status !== 'ready' ||
            plugin.revision !== input.expectedRevision ||
            plugin.runtimeGeneration !== input.expectedRuntimeGeneration
          ) {
            throw new Error('Plugin changed. Ask for the window header state again.')
          }
          const store = await deps.getPersistenceStore()
          const state = normalizePersistedAppState(await store.readAppState())
          if (!state?.workspaces.some(project => project.id === input.projectId)) {
            throw new Error('Window header project is no longer available.')
          }
          return plugin
        }
        const plugin = await current()
        const button = plugin.nodeHeader?.find(item => item.id === input.buttonId)
        if (!button) {
          throw new Error('Plugin window header button is not declared.')
        }
        const value = await deps.plugins.runCommand(
          input.pluginId,
          button.stateCommand,
          { projectId: input.projectId },
          { context: { surface: 'canvas', projectId: input.projectId } },
          plugin,
        )
        await current()
        return { nodes: normalizePluginNodeHeaderState(value) }
      } catch (cause) {
        return fail(cause)
      }
    },
    defaultErrorCode: 'plugin.operation_failed',
  })
}
