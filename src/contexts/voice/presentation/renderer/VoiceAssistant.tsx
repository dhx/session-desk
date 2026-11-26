import React, { useMemo } from 'react'
import type { AgentSettings } from '@contexts/settings/domain'
import { useAppStore } from '@app/renderer/shell/store/useAppStore'
import { listVoiceBossAgents } from './bossChannel'
import { useVoiceAssistant } from './useVoiceAssistant'
import { VoiceHoldButton } from './VoiceHoldButton'
import { VoiceIndicator } from './VoiceIndicator'
import { VoiceTargetPicker } from './VoiceTargetPicker'

export function VoiceAssistant({
  settings,
  onPickBoss,
}: {
  settings: Pick<AgentSettings, 'voice' | 'keybindings'>
  onPickBoss: (nodeId: string) => void
}): React.JSX.Element | null {
  const { enabled, turn, engine, hold } = useVoiceAssistant(settings)
  const bossNodeId = settings.voice.bossNodeId
  const workspaces = useAppStore(state => state.workspaces)
  const agents = useMemo(() => listVoiceBossAgents(workspaces), [workspaces])
  const bossTitle = agents.find(agent => agent.nodeId === bossNodeId)?.title ?? ''

  if (!enabled) {
    return null
  }
  return (
    <>
      <VoiceIndicator turn={turn} engine={engine} bossTitle={bossTitle} />
      {hold && bossTitle ? <VoiceHoldButton hold={hold} turn={turn} bossTitle={bossTitle} /> : null}
      {hold ? (
        <VoiceTargetPicker
          agents={agents}
          bossNodeId={bossTitle ? bossNodeId : null}
          showWorkspace={workspaces.length > 1}
          onPick={onPickBoss}
        />
      ) : null}
    </>
  )
}
