import type { ManagedClaudeBindingObservation } from '../../../shared/contracts/managedClaudeLaunch'
import type { PluginAgentConversation } from './pluginCanvasTypes'

/** The conversation a managed Claude window runs now, when the Worker has confirmed it. */
export function pluginAgentConversation(
  binding: ManagedClaudeBindingObservation | null | undefined,
  sessionId: string | null | undefined,
): PluginAgentConversation | null {
  if (!binding || !binding.tuple.resumeSessionIdVerified || !binding.tuple.resumeSessionId) {
    return null
  }
  // A binding of an earlier or later process of this window says nothing about this one.
  if (!sessionId || binding.runtimeSessionId !== sessionId) {
    return null
  }
  return { id: binding.tuple.resumeSessionId }
}
