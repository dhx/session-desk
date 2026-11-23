// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { normalizeLocalPluginPackage } from '../../../src/contexts/plugins/domain/localPluginValidation'
import { resolveHostTheme } from '../../../src/contexts/plugins/domain/pluginThemes'
import {
  DEFAULT_AGENT_SETTINGS,
  normalizeAgentSettings,
} from '../../../src/contexts/settings/domain/agentSettings'

const root = resolve(__dirname, '../../../plugins/classic-theme')
const manifest = JSON.parse(readFileSync(resolve(root, 'opencove.plugin.json'), 'utf8'))

describe('Session Desk Classic theme package', () => {
  it('is a valid theme-only package with a dark and a light theme that ask for line icons', () => {
    const pkg = normalizeLocalPluginPackage(manifest)
    expect(pkg.id).toBe('session-desk-classic')
    expect(pkg.view).toBeUndefined()
    expect(pkg.main).toBeUndefined()
    expect(
      pkg.contributes?.themes?.map(theme => [theme.id, theme.appearance, theme.icons]),
    ).toEqual([
      ['dark', 'dark', 'line'],
      ['light', 'light', 'line'],
    ])
    for (const theme of pkg.contributes?.themes ?? []) {
      expect(theme.extends).toBe(theme.appearance)
      expect(theme.stylesheet).toBe('classic.css')
      expect(theme.motion).toMatchObject({
        background: { preset: 'none' },
        creation: { preset: 'none' },
        closing: { preset: 'none' },
        working: { preset: 'none' },
      })
    }
  })

  it('ships a stylesheet the host accepts: public hooks only, no imports or remote resources', () => {
    const css = readFileSync(resolve(root, 'classic.css'), 'utf8')
    expect(css).not.toMatch(/@import|url\s*\(|!important/)
    // Private implementation classes are not part of the skin contract.
    expect(css.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/(^|[\s,>+~])\.[a-z]/m)
    expect(readFileSync(resolve(root, 'README.md'), 'utf8')).toContain('Classic Dark')
  })
})

describe('the default theme of this fork', () => {
  it('is Classic Dark for someone without a saved theme, and never replaces a saved one', () => {
    expect(DEFAULT_AGENT_SETTINGS.uiTheme).toBe('plugin:session-desk-classic:dark')
    expect(normalizeAgentSettings({}).uiTheme).toBe('plugin:session-desk-classic:dark')
    expect(normalizeAgentSettings({ uiTheme: 'dark' }).uiTheme).toBe('dark')
    expect(normalizeAgentSettings({ uiTheme: 'light' }).uiTheme).toBe('light')
    expect(normalizeAgentSettings({ uiTheme: 'pixel' }).uiTheme).toBe('dark')
  })

  it('names a theme the package really declares, and falls back to Cove dark without it', () => {
    const pkg = normalizeLocalPluginPackage(manifest)
    const plugin = {
      id: pkg.id,
      version: pkg.version,
      displayName: pkg.displayName,
      description: pkg.description,
      nodeKinds: [],
      actionBar: false,
      contextMenu: false,
      enabled: true,
      status: 'ready' as const,
      themes: pkg.contributes?.themes,
    }
    const choice = DEFAULT_AGENT_SETTINGS.uiTheme
    expect(resolveHostTheme(choice, [plugin], choice)).toMatchObject({
      id: choice,
      theme: { id: 'dark', icons: 'line' },
    })
    expect(resolveHostTheme(choice, [], choice)).toEqual({ id: 'dark' })
    expect(resolveHostTheme(choice, [{ ...plugin, enabled: false }], choice)).toEqual({
      id: 'dark',
    })
  })
})
