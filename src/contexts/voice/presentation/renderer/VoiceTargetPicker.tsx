import React, { useRef, useState } from 'react'
import { ChevronUpIcon, RobotIcon } from '@app/renderer/components/ui/pixelIcons'
import { ViewportMenuSurface } from '@app/renderer/components/ViewportMenuSurface'
import { Button } from '@app/renderer/components/ui/Button'
import { MenuCheckboxItem, MenuItem } from '@app/renderer/components/ui/Menu'
import { useTranslation } from '@app/renderer/i18n'
import type { VoiceBossAgent } from './bossChannel'

/**
 * The agent voice goes to, beside the hold button: tap it to send the next words to another agent
 * window without opening the settings. Picking writes the same setting the settings panel does.
 */
export function VoiceTargetPicker({
  agents,
  bossNodeId,
  showWorkspace,
  onPick,
}: {
  agents: readonly VoiceBossAgent[]
  bossNodeId: string | null
  showWorkspace: boolean
  onPick: (nodeId: string) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null)
  const boss = agents.find(agent => agent.nodeId === bossNodeId) ?? null
  const label = (agent: VoiceBossAgent): string =>
    showWorkspace ? `${agent.title} · ${agent.workspaceName}` : agent.title

  return (
    <>
      <Button
        ref={triggerRef}
        variant="secondary"
        size="sm"
        className="voice-target-button"
        data-testid="voice-target-button"
        aria-haspopup="menu"
        aria-expanded={point !== null}
        aria-label={
          boss ? t('voice.target.buttonLabel', { boss: boss.title }) : t('voice.target.chooseLabel')
        }
        onClick={() => {
          if (point) {
            setPoint(null)
            return
          }
          const rect = triggerRef.current?.getBoundingClientRect()
          setPoint(rect ? { x: rect.left, y: rect.top } : { x: 0, y: 0 })
        }}
      >
        <span className="voice-target-button__text">
          {boss ? boss.title : t('voice.target.choose')}
        </span>
        <ChevronUpIcon aria-hidden="true" size={12} />
      </Button>
      <ViewportMenuSurface
        open={point !== null}
        role="menu"
        // The class is what makes the surface a menu: fixed position, focus, the sheet on a phone.
        className="workspace-context-menu"
        aria-label={t('voice.target.menuLabel')}
        mobileTitle={t('voice.target.menuLabel')}
        data-testid="voice-target-menu"
        placement={{
          type: 'point',
          point: point ?? { x: 0, y: 0 },
          alignX: 'start',
          alignY: 'end',
          flipY: true,
          gapY: 8,
        }}
        dismissOnEscape
        dismissOnPointerDownOutside
        dismissIgnoreRefs={[triggerRef]}
        onDismiss={() => setPoint(null)}
      >
        {agents.length === 0 ? (
          <MenuItem icon={<RobotIcon />} disabled>
            {t('voice.settings.bossNoAgents')}
          </MenuItem>
        ) : (
          agents.map(agent => (
            <MenuCheckboxItem
              key={agent.nodeId}
              icon={<RobotIcon />}
              checked={agent.nodeId === boss?.nodeId}
              data-testid={`voice-target-option-${agent.nodeId}`}
              onCheckedChange={() => {
                setPoint(null)
                onPick(agent.nodeId)
              }}
            >
              {label(agent)}
            </MenuCheckboxItem>
          ))
        )}
      </ViewportMenuSurface>
    </>
  )
}
