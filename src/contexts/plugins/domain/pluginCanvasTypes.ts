import type { CanvasNodeDetailDto, ListSessionsResult } from '../../../shared/contracts/dto'

export interface PluginSessionState {
  node: CanvasNodeDetailDto
  session: ListSessionsResult['sessions'][number] | null
  agentState: import('../../../shared/contracts/dto/agentRunState').AgentRunSnapshot | null
  /**
   * Session Desk: the provider conversation the Worker has confirmed for this window right now
   * (Claude Code, also after /clear), or null. The command line keeps the ID it started with.
   */
  conversation: PluginAgentConversation | null
}

export interface PluginAgentConversation {
  id: string
}

export type PluginObservationType = 'project' | 'space' | 'node' | 'session' | 'preferences'
export interface PluginObservationChange {
  type: PluginObservationType
  id: string
  change: 'created' | 'changed' | 'removed'
}
export interface PluginObservationBatch {
  subscriptionId: string
  sequence: number
  changes: PluginObservationChange[]
  truncated: boolean
}
