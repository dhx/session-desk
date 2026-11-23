// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { normalizeLocalPluginPackage } from '../../../src/contexts/plugins/domain/localPluginValidation'

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
