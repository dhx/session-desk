import React, { useEffect, useState } from 'react'
import { CoveSelect } from '@app/renderer/components/CoveSelect'
import { Toggle } from '@app/renderer/components/ui/Toggle'
import { useTranslation } from '@app/renderer/i18n'
import {
  SettingsGroup,
  SettingsGroupBody,
} from '@contexts/settings/presentation/renderer/settingsPanel/SettingsGroup'
import { formatKeyChord, resolveCommandKeybinding } from '@contexts/settings/domain/keybindings'
import type { AgentSettings } from '@contexts/settings/domain/agentSettings'
import type { WorkspaceState } from '@contexts/workspace/presentation/renderer/types'
import type { VoiceEngineStatus } from '@shared/contracts/dto'
import {
  VOICE_LANGUAGE_SETTINGS,
  type VoiceEngineId,
  type VoiceLanguageSetting,
  type VoiceSettings,
} from '../../domain/voiceSettings'
import { listVoiceBossAgents } from './bossChannel'
import { getPlatform, getVoiceBridge } from './voiceApi'

const NO_BOSS = ''

/** The engine's status as this server reports it; null until it answered. */
function useVoiceEngineStatus(): VoiceEngineStatus | null {
  const [status, setStatus] = useState<VoiceEngineStatus | null>(null)
  useEffect(() => {
    const bridge = getVoiceBridge()
    if (!bridge) {
      return
    }
    let disposed = false
    const apply = (next: VoiceEngineStatus): void => {
      if (!disposed) {
        setStatus(next)
      }
    }
    const stop = bridge.onStatus(apply)
    void bridge.getStatus().then(apply, () => undefined)
    return () => {
      disposed = true
      stop()
    }
  }, [])
  return status
}

function SettingsRow({
  label,
  help,
  children,
}: {
  label: string
  help: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="settings-panel__row">
      <div className="settings-panel__row-label">
        <strong>{label}</strong>
        <span>{help}</span>
      </div>
      <div className="settings-panel__control">{children}</div>
    </div>
  )
}

export function VoiceSection({
  voice,
  keybindings,
  workspaces,
  onChange,
}: {
  voice: VoiceSettings
  keybindings: AgentSettings['keybindings']
  workspaces: readonly WorkspaceState[]
  onChange: (voice: VoiceSettings) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const status = useVoiceEngineStatus()
  // True once this server said it has no speech models, so voice cannot work here at all.
  const notInstalled = status?.state === 'error' && status.reason === 'models_missing'
  const languageName = (language: string): string => t(`voice.settings.languages.${language}`)
  // Which languages have a voice is known once the models are loaded.
  const languageHelp = (() => {
    if (status?.state !== 'ready') {
      return t('voice.settings.languageHelp')
    }
    const missing = status.languages.filter(entry => !entry.voiceInstalled)
    if (missing.length === 0) {
      return t('voice.settings.languageHelp')
    }
    return t('voice.settings.voiceMissing', {
      languages: missing.map(entry => languageName(entry.language)).join(', '),
    })
  })()
  const update = (patch: Partial<VoiceSettings>): void => onChange({ ...voice, ...patch })

  const platform = getPlatform()
  const shortcut = formatKeyChord(
    platform,
    resolveCommandKeybinding({ commandId: 'voice.pushToTalk', overrides: keybindings, platform }),
  )

  const agents = listVoiceBossAgents(workspaces)
  // A boss whose node was closed shows as unset; the stored id stays until the user picks again.
  const bossMissing = voice.bossNodeId !== null && !agents.some(a => a.nodeId === voice.bossNodeId)
  const bossHelp = bossMissing
    ? t('voice.settings.bossMissing')
    : agents.length === 0
      ? t('voice.settings.bossNoAgents')
      : t('voice.settings.bossHelp')

  return (
    <SettingsGroup
      id="settings-section-voice"
      title={t('voice.settings.groupTitle')}
      description={`${t('voice.settings.groupHelp')} ${t('voice.settings.shortcutHelp', { shortcut })}`}
    >
      <SettingsGroupBody>
        <SettingsRow
          label={t('voice.settings.enabledLabel')}
          help={notInstalled ? t('voice.settings.notInstalled') : t('voice.settings.enabledHelp')}
        >
          <Toggle
            data-testid="settings-voice-enabled"
            checked={voice.enabled}
            label={t('voice.settings.enabledLabel')}
            onCheckedChange={enabled => update({ enabled })}
          />
        </SettingsRow>

        <SettingsRow label={t('voice.settings.bossLabel')} help={bossHelp}>
          <CoveSelect
            id="settings-voice-boss"
            testId="settings-voice-boss"
            ariaLabel={t('voice.settings.bossLabel')}
            value={bossMissing ? NO_BOSS : (voice.bossNodeId ?? NO_BOSS)}
            options={[
              { value: NO_BOSS, label: t('voice.settings.bossNone') },
              ...agents.map(agent => ({
                value: agent.nodeId,
                label:
                  workspaces.length > 1 ? `${agent.title} · ${agent.workspaceName}` : agent.title,
              })),
            ]}
            onChange={nodeId => update({ bossNodeId: nodeId === NO_BOSS ? null : nodeId })}
          />
        </SettingsRow>

        <SettingsRow label={t('voice.settings.engineLabel')} help={t('voice.settings.engineHelp')}>
          <CoveSelect
            id="settings-voice-engine"
            testId="settings-voice-engine"
            ariaLabel={t('voice.settings.engineLabel')}
            value={voice.engine}
            options={[
              { value: 'local', label: t('voice.settings.engineLocal') },
              {
                value: 'openai-realtime',
                label: t('voice.settings.engineRealtime'),
                disabled: true,
                badge: t('voice.settings.comingSoon'),
              },
            ]}
            onChange={engine => update({ engine: engine as VoiceEngineId })}
          />
        </SettingsRow>

        <SettingsRow label={t('voice.settings.languageLabel')} help={languageHelp}>
          <CoveSelect
            id="settings-voice-language"
            testId="settings-voice-language"
            ariaLabel={t('voice.settings.languageLabel')}
            value={voice.language}
            options={VOICE_LANGUAGE_SETTINGS.map(language => ({
              value: language,
              label: languageName(language),
            }))}
            onChange={language => update({ language: language as VoiceLanguageSetting })}
          />
        </SettingsRow>

        <SettingsRow
          label={t('voice.settings.speakRepliesLabel')}
          help={t('voice.settings.speakRepliesHelp')}
        >
          <Toggle
            data-testid="settings-voice-speak-replies"
            checked={voice.speakReplies}
            label={t('voice.settings.speakRepliesLabel')}
            onCheckedChange={speakReplies => update({ speakReplies })}
          />
        </SettingsRow>
      </SettingsGroupBody>
    </SettingsGroup>
  )
}
