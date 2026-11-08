import { useCallback, useSyncExternalStore, type JSX } from 'react'
import { useAppStore } from '@app/renderer/shell/store/useAppStore'
import { useTranslation } from '@app/renderer/i18n'
import { IconButton } from '@app/renderer/components/ui/IconButton'
import { isPluginContributionEnabled } from '@contexts/settings/domain/pluginSettings'
import type { PluginNodeHeaderDeclaration } from '../../domain/pluginNodeHeader'
import { pluginNodeHeaderUrl } from '../../domain/pluginNodeHeader'
import type { PluginManifest } from '../../domain/pluginTypes'
import { PluginIcon } from './PluginIcon'
import { usePluginRegistry } from './usePluginRegistry'
import { readPluginNodeHeader, subscribePluginNodeHeader } from './pluginNodeHeaderStore'

/** Opens in the person's own browser (desktop: the system browser, via the window-open handler). */
export function openPluginNodeHeaderLink(url: string): void {
  const safe = pluginNodeHeaderUrl(url)
  if (safe) {
    window.open(safe, '_blank', 'noopener,noreferrer')
  }
}

function PluginNodeHeaderButton({
  plugin,
  button,
  projectId,
  nodeId,
}: {
  plugin: PluginManifest
  button: PluginNodeHeaderDeclaration
  projectId: string
  nodeId: string
}): JSX.Element {
  const { t } = useTranslation()
  const subscribe = useCallback(
    (listener: () => void) => subscribePluginNodeHeader(plugin, button.id, projectId, listener),
    [plugin, button.id, projectId],
  )
  const link = useSyncExternalStore(
    subscribe,
    () => readPluginNodeHeader(plugin, button.id, projectId)[nodeId] ?? null,
    () => null,
  )
  const label = link ? (link.title ?? button.title) : button.title
  const title = link ? label : t('terminalNodeHeader.pluginLinkUnavailable', { title: label })
  return (
    <IconButton
      label={title}
      size="xs"
      className="terminal-node__action terminal-node__action--icon nodrag"
      data-testid={`terminal-node-plugin-link-${plugin.id}-${button.id}`}
      disabled={!link}
      onClick={event => {
        event.stopPropagation()
        if (link) {
          openPluginNodeHeaderLink(link.url)
        }
      }}
    >
      <PluginIcon pluginId={plugin.id} className="terminal-node__action-icon" size={14} />
    </IconButton>
  )
}

/**
 * Link buttons plugins declare for window headers. They do not depend on which agent or
 * shell runs in the window: whether one is enabled is only the plugin's answer for this node.
 */
export function PluginNodeHeaderActions({ nodeId }: { nodeId: string }): JSX.Element | null {
  const projectId = useAppStore(state => state.activeWorkspaceId)
  const settings = useAppStore(state => state.agentSettings)
  const { plugins } = usePluginRegistry()
  if (!projectId) {
    return null
  }
  const buttons = plugins
    .filter(
      plugin =>
        plugin.enabled !== false &&
        plugin.status === 'ready' &&
        isPluginContributionEnabled(settings, plugin.id, 'nodeHeader'),
    )
    .flatMap(plugin => (plugin.nodeHeader ?? []).map(button => ({ plugin, button })))
  if (!buttons.length) {
    return null
  }
  return (
    <>
      {buttons.map(({ plugin, button }) => (
        <PluginNodeHeaderButton
          key={`${plugin.id}:${plugin.revision}:${plugin.runtimeGeneration}:${button.id}`}
          plugin={plugin}
          button={button}
          projectId={projectId}
          nodeId={nodeId}
        />
      ))}
    </>
  )
}
