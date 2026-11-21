import { describe, expect, it } from 'vitest'
import { pluginAgentConversation } from '../../../src/contexts/plugins/domain/pluginAgentConversation'
import type { ManagedClaudeBindingObservation } from '../../../src/shared/contracts/managedClaudeLaunch'

const binding = (
  resumeSessionId: string | null,
  verified: boolean,
  runtimeSessionId: string | null = 'pty-1',
): ManagedClaudeBindingObservation => ({
  nodeId: 'node',
  activationId: 'activation',
  runtimeSessionId,
  tuple: { resumeSessionId, resumeSessionIdVerified: verified },
  nodeSeen: true,
  bindingRevision: 1,
  observedRevision: 1,
})

// Session Desk: plugins see the conversation a Claude window runs now. After /clear the Worker
// rebinds the window to the new conversation in the same process, while the command line still
// names the one it started with (managedClaudeClearBinding.native.spec.ts).
describe('pluginAgentConversation', () => {
  it('names the confirmed conversation of the running process', () => {
    expect(pluginAgentConversation(binding('after-clear', true), 'pty-1')).toEqual({
      id: 'after-clear',
    })
  })

  it('says nothing it cannot vouch for', () => {
    expect(pluginAgentConversation(undefined, 'pty-1')).toBeNull()
    expect(pluginAgentConversation(binding('guess', false), 'pty-1')).toBeNull()
    expect(pluginAgentConversation(binding(null, true), 'pty-1')).toBeNull()
    // A binding of another process of this window.
    expect(pluginAgentConversation(binding('old', true, 'pty-0'), 'pty-1')).toBeNull()
    expect(pluginAgentConversation(binding('old', true), null)).toBeNull()
  })
})
