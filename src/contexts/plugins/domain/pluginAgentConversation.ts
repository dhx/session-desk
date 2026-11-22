import type { ManagedClaudeBindingObservation } from '../../../shared/contracts/managedClaudeLaunch'
import type { PluginAgentConversation } from './pluginCanvasTypes'

/** The conversation a managed Claude window runs now, when the Worker has confirmed it. */
export function pluginAgentConversation(
  binding: ManagedClaudeBindingObservation | null | undefined,
  session: { sessionId: string; status: string } | null | undefined,
): PluginAgentConversation | null {
  if (!binding || !binding.tuple.resumeSessionIdVerified || !binding.tuple.resumeSessionId) {
    return null
  }
  // Only a running process runs a conversation; a binding of an earlier or later process of
  // this window says nothing about this one.
  if (!session || session.status !== 'running' || binding.runtimeSessionId !== session.sessionId) {
    return null
  }
  return { id: binding.tuple.resumeSessionId }
}
