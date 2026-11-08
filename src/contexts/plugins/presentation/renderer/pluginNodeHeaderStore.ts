import type { PluginNodeHeaderState } from '../../domain/pluginNodeHeader'
import type { PluginManifest } from '../../domain/pluginTypes'
import { getPluginManifest } from './usePluginRegistry'

/**
 * One poller per (plugin revision, button, project), shared by every window header that shows
 * the button. It runs only while at least one header listens and skips ticks while the page
 * is hidden; a header that mounts asks at once, so a new window does not wait a full interval.
 */
export const PLUGIN_NODE_HEADER_POLL_MS = 10_000

const EMPTY: PluginNodeHeaderState = Object.freeze({}) as PluginNodeHeaderState

interface Poller {
  state: PluginNodeHeaderState
  listeners: Set<() => void>
  timer: ReturnType<typeof setInterval> | null
  pending: boolean
  plugin: PluginManifest
  buttonId: string
  projectId: string
}

const pollers = new Map<string, Poller>()

export function pluginNodeHeaderKey(
  plugin: PluginManifest,
  buttonId: string,
  projectId: string,
): string {
  return [
    plugin.id,
    plugin.revision ?? '',
    plugin.runtimeGeneration ?? 0,
    buttonId,
    projectId,
  ].join('\u0000')
}

function isCurrent(poller: Poller): boolean {
  const value = getPluginManifest(poller.plugin.id)
  return (
    value?.enabled !== false &&
    value?.status === 'ready' &&
    value.revision === poller.plugin.revision &&
    value.runtimeGeneration === poller.plugin.runtimeGeneration
  )
}

function publish(poller: Poller, state: PluginNodeHeaderState): void {
  if (JSON.stringify(state) === JSON.stringify(poller.state)) {
    return
  }
  poller.state = state
  poller.listeners.forEach(listener => listener())
}

async function refresh(poller: Poller): Promise<void> {
  if (poller.pending || !poller.listeners.size) {
    return
  }
  if (!isCurrent(poller)) {
    publish(poller, EMPTY)
    return
  }
  if (typeof document !== 'undefined' && document.hidden && poller.state !== EMPTY) {
    return
  }
  poller.pending = true
  try {
    const result = await window.opencoveApi.controlSurface.invoke<{
      nodes: PluginNodeHeaderState
    }>({
      kind: 'query',
      id: 'plugin.nodeHeader.state',
      payload: {
        pluginId: poller.plugin.id,
        buttonId: poller.buttonId,
        projectId: poller.projectId,
        expectedRevision: poller.plugin.revision,
        expectedRuntimeGeneration: poller.plugin.runtimeGeneration,
      },
    })
    publish(poller, isCurrent(poller) ? (result.nodes ?? EMPTY) : EMPTY)
  } catch {
    // The plugin is unreachable or changed: show the button disabled, try again next tick.
    publish(poller, EMPTY)
  } finally {
    poller.pending = false
  }
}

export function subscribePluginNodeHeader(
  plugin: PluginManifest,
  buttonId: string,
  projectId: string,
  listener: () => void,
): () => void {
  const key = pluginNodeHeaderKey(plugin, buttonId, projectId)
  let poller = pollers.get(key)
  if (!poller) {
    poller = {
      state: EMPTY,
      listeners: new Set(),
      timer: null,
      pending: false,
      plugin,
      buttonId,
      projectId,
    }
    pollers.set(key, poller)
  }
  const current = poller
  current.listeners.add(listener)
  if (!current.timer) {
    current.timer = setInterval(() => void refresh(current), PLUGIN_NODE_HEADER_POLL_MS)
  }
  void refresh(current)
  return () => {
    current.listeners.delete(listener)
    if (!current.listeners.size) {
      if (current.timer) {
        clearInterval(current.timer)
      }
      pollers.delete(key)
    }
  }
}

export function readPluginNodeHeader(
  plugin: PluginManifest,
  buttonId: string,
  projectId: string,
): PluginNodeHeaderState {
  return pollers.get(pluginNodeHeaderKey(plugin, buttonId, projectId))?.state ?? EMPTY
}

/** Test seam: forget every poller. */
export function resetPluginNodeHeaderPollers(): void {
  pollers.forEach(poller => poller.timer && clearInterval(poller.timer))
  pollers.clear()
}
