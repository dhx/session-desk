/**
 * The node kinds a plugin can read as a session (a terminal or an agent window), with what differs
 * between them. Callers read a field instead of comparing the kind.
 */
export interface PluginSessionNodeKindDescriptor {
  /** How an error message names a node of this kind. */
  readonly article: string
  /** Whether the node carries an agent conversation (managed Claude binding). */
  readonly hasConversation: boolean
}

export type PluginSessionNodeKind = 'agent' | 'terminal'

export const PLUGIN_SESSION_NODE_KINDS = {
  agent: { article: 'an agent', hasConversation: true },
  terminal: { article: 'a terminal', hasConversation: false },
} as const satisfies Record<PluginSessionNodeKind, PluginSessionNodeKindDescriptor>

/** The descriptor of a node kind, or null for kinds that are not sessions. */
export function pluginSessionNodeKind(kind: string): PluginSessionNodeKindDescriptor | null {
  return Object.hasOwn(PLUGIN_SESSION_NODE_KINDS, kind)
    ? PLUGIN_SESSION_NODE_KINDS[kind as PluginSessionNodeKind]
    : null
}
