import type { PluginCommandDeclaration } from './pluginTypes'
import { pluginJsonValue } from './pluginJsonValue'

/**
 * A link button a plugin adds to the header of every terminal and agent window.
 * The host renders it; the plugin only says, per window, which address it opens.
 */
export interface PluginNodeHeaderDeclaration {
  id: string
  title: string
  stateCommand: string
}

export interface PluginNodeHeaderLink {
  url: string
  title?: string
}

/** Window id → link; a window without an entry shows the button disabled. */
export type PluginNodeHeaderState = Record<string, PluginNodeHeaderLink>

export const PLUGIN_NODE_HEADER_LIMIT = 4
export const PLUGIN_NODE_HEADER_STATE_NODE_LIMIT = 2000

function record(value: unknown, allowed: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some(key => !allowed.includes(key))
  ) {
    throw new Error('Invalid plugin window header fields.')
  }
  return value as Record<string, unknown>
}

function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new Error('Invalid plugin window header text.')
  }
  return value.trim()
}

export function normalizePluginNodeHeader(
  value: unknown,
  commands: readonly PluginCommandDeclaration[],
): PluginNodeHeaderDeclaration[] {
  if (value === undefined) {
    return []
  }
  if (!Array.isArray(value) || value.length > PLUGIN_NODE_HEADER_LIMIT) {
    throw new Error(`Plugin window header limit is ${PLUGIN_NODE_HEADER_LIMIT} buttons.`)
  }
  const ids = new Set<string>()
  return value.map(item => {
    const raw = record(item, ['id', 'title', 'stateCommand'])
    const id = text(raw.id, 80)
    if (!/^[a-z][a-z0-9-]*$/.test(id) || ids.has(id)) {
      throw new Error('Invalid or duplicate window header id.')
    }
    ids.add(id)
    const stateCommand = text(raw.stateCommand, 80)
    if (!commands.some(command => command.id === stateCommand && command.target === 'plugin')) {
      throw new Error('Window header stateCommand must name a declared backend command.')
    }
    return { id, title: text(raw.title, 120), stateCommand }
  })
}

/** Only absolute http(s) addresses open; anything else counts as "no link". */
export function pluginNodeHeaderUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim() || value.length > 2048) {
    return null
  }
  try {
    const parsed = new URL(value.trim())
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : null
  } catch {
    return null
  }
}

/**
 * The provider returns `{ nodes: { [nodeId]: { url, title? } } }`. Entries without a usable
 * address are dropped rather than failing the whole answer, so one bad window cannot disable
 * the button on every other.
 */
export function normalizePluginNodeHeaderState(value: unknown): PluginNodeHeaderState {
  const raw = record(pluginJsonValue(value, 128 * 1024, 'window header state'), ['nodes'])
  const nodes = raw.nodes === undefined ? {} : raw.nodes
  if (!nodes || typeof nodes !== 'object' || Array.isArray(nodes)) {
    throw new Error('Plugin window header state must map window ids to links.')
  }
  const entries = Object.entries(nodes as Record<string, unknown>)
  if (entries.length > PLUGIN_NODE_HEADER_STATE_NODE_LIMIT) {
    throw new Error(
      `Plugin window header state is limited to ${PLUGIN_NODE_HEADER_STATE_NODE_LIMIT} windows.`,
    )
  }
  const result: PluginNodeHeaderState = {}
  for (const [nodeId, entry] of entries) {
    if (!nodeId || nodeId.length > 200 || !entry || typeof entry !== 'object') {
      continue
    }
    const link = entry as Record<string, unknown>
    const url = pluginNodeHeaderUrl(link.url)
    if (!url) {
      continue
    }
    const title =
      typeof link.title === 'string' && link.title.trim() && link.title.length <= 200
        ? link.title.trim()
        : undefined
    result[nodeId] = title ? { url, title } : { url }
  }
  return result
}
