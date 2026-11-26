import type { PixelEffectSettings } from './agentSettings.types'
import type { UiTheme } from './uiSettings'

/**
 * This fork has no pixel look (docs/dhx/RELEASES.md): the pixel wall and the creation, close and
 * working effects are off for everyone and have no switches. Whatever an older profile or an
 * upstream build stored for them is read and dropped, so the saved settings stay loadable.
 */
export function normalizePixelEffectSettings(
  _value: Record<string, unknown>,
  _savedUiTheme: UiTheme | null,
): PixelEffectSettings {
  return { ...PIXEL_EFFECTS_OFF }
}

export const PIXEL_EFFECTS_OFF: PixelEffectSettings = {
  canvasBackgroundStyle: 'off',
  canvasBackgroundTwinkleEnabled: false,
  nodeCreationPixelEffectEnabled: false,
  nodeClosePixelEffectEnabled: false,
  agentWorkingPixelEffectEnabled: false,
}
