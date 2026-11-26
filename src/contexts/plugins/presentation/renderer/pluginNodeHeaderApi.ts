import type { PluginNodeHeaderState } from '../../domain/pluginNodeHeader'
import type { PluginManifest } from '../../domain/pluginTypes'

/** Transport adapter: the plugin node-header poller's only way to `window.opencoveApi`. */
export async function queryPluginNodeHeaderState(payload: {
  pluginId: PluginManifest['id']
  buttonId: string
  projectId: string | null
  expectedRevision: PluginManifest['revision']
  expectedRuntimeGeneration: PluginManifest['runtimeGeneration']
}): Promise<PluginNodeHeaderState | undefined> {
  const result = await window.opencoveApi.controlSurface.invoke<{
    nodes: PluginNodeHeaderState
  }>({
    kind: 'query',
    id: 'plugin.nodeHeader.state',
    payload,
  })
  return result.nodes
}
