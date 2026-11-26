import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  DEFAULT_AGENT_SETTINGS,
  normalizeAgentSettings,
} from '../../../src/contexts/settings/domain/agentSettings'
import { normalizePluginThemes } from '../../../src/contexts/plugins/domain/pluginHostExtensionValidation'

/**
 * This fork has one look, the plain one (docs/dhx/RELEASES.md). These are the settings-level
 * guarantees an upstream merge must keep: no pixel effect can be switched on by any stored value,
 * and what people had selected while Classic was a plugin still loads.
 */
const off = {
  canvasBackgroundStyle: 'off',
  canvasBackgroundTwinkleEnabled: false,
  nodeCreationPixelEffectEnabled: false,
  nodeClosePixelEffectEnabled: false,
  agentWorkingPixelEffectEnabled: false,
}

describe('Session Desk has no pixel look', () => {
  it.each([
    undefined,
    {},
    { uiTheme: 'pixel' },
    { canvasBackgroundStyle: 'pixel', canvasBackgroundTwinkleEnabled: true },
    { canvasPixelBackgroundEnabled: true },
    {
      nodeCreationPixelEffectEnabled: true,
      nodeClosePixelEffectEnabled: true,
      agentWorkingPixelEffectEnabled: true,
    },
  ])('keeps every pixel effect off, whatever was stored: %j', stored => {
    expect(normalizeAgentSettings(stored)).toMatchObject(off)
  })

  it('starts with the effects off and the built-in dark theme', () => {
    expect(DEFAULT_AGENT_SETTINGS).toMatchObject({ ...off, uiTheme: 'dark' })
  })

  it.each([
    ['plugin:session-desk-classic:dark', 'dark'],
    ['plugin:session-desk-classic:light', 'light'],
    ['pixel', 'dark'],
    ['pixel-light', 'light'],
    ['light', 'light'],
    ['system', 'system'],
    ['plugin:other:theme', 'plugin:other:theme'],
  ])('loads the stored theme %s as %s', (stored, applied) => {
    expect(normalizeAgentSettings({ uiTheme: stored }).uiTheme).toBe(applied)
  })

  it('accepts a theme written for the retired icon option, without the option', () => {
    const [theme] = normalizePluginThemes([
      { id: 'night', title: 'Night', appearance: 'dark', extends: 'dark', icons: 'pixel' },
    ])
    expect(theme).not.toHaveProperty('icons')
  })

  it('loads the fork stylesheet last in the app layer, after the styles it replaces', () => {
    const styles = readFileSync(resolve(__dirname, '../../../src/app/renderer/styles.css'), 'utf8')
    const layered = [...styles.matchAll(/@import '(.+?)' layer\(opencove\);/g)].map(m => m[1])
    expect(layered.at(-1)).toBe('./styles/themes/dhx-classic.css')
  })
})
