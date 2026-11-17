import React, { useRef } from 'react'
// The pixel icon set has no microphone; its audio glyph stands for speech input.
import { AudioIcon } from '@app/renderer/components/ui/pixelIcons'
import { IconButton } from '@app/renderer/components/ui/IconButton'
import { useTranslation } from '@app/renderer/i18n'
import type { VoiceTurnState } from '../../domain/voiceTurn'
import type { VoiceHoldControls } from './useVoiceAssistant'

/**
 * Push-to-talk for touch: hold to record, let go to send, as on a walkie-talkie. Also there on
 * desktop, beside the keyboard shortcut. A touch the browser takes over (a scroll, an incoming
 * call) cancels instead of sending.
 */
export function VoiceHoldButton({
  hold,
  turn,
  bossTitle,
}: {
  hold: VoiceHoldControls
  turn: VoiceTurnState
  bossTitle: string
}): React.JSX.Element {
  const { t } = useTranslation()
  const pressed = useRef(false)

  const start = (): void => {
    if (!pressed.current) {
      pressed.current = true
      hold.press()
    }
  }
  const end = (send: boolean): void => {
    if (!pressed.current) {
      return
    }
    pressed.current = false
    if (send) {
      hold.release()
    } else {
      hold.cancel()
    }
  }

  return (
    <IconButton
      label={t('voice.holdButton.label', { boss: bossTitle })}
      variant="secondary"
      size="md"
      className="voice-hold-button"
      data-testid="voice-hold-button"
      data-voice-phase={turn.phase}
      aria-pressed={turn.phase === 'listening'}
      onPointerDown={event => {
        if (event.button !== 0) {
          return
        }
        event.preventDefault()
        // Keep the hold when the finger drifts off the button.
        event.currentTarget.setPointerCapture(event.pointerId)
        start()
      }}
      onPointerUp={() => end(true)}
      onPointerCancel={() => end(false)}
      onLostPointerCapture={() => end(true)}
      onKeyDown={event => {
        if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) {
          event.preventDefault()
          start()
        }
      }}
      onKeyUp={event => {
        if (event.key === ' ' || event.key === 'Enter') {
          event.preventDefault()
          end(true)
        }
      }}
      onBlur={() => end(false)}
      onContextMenu={event => event.preventDefault()}
    >
      <AudioIcon aria-hidden="true" size={24} />
    </IconButton>
  )
}
