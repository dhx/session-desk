import { act, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { applyIconSet, DEFAULT_ICON_SET, isIconSet, readIconSet } from './iconSet'
import { LINE_GLYPHS, LINE_ICONS } from './lineIcons'
import { PixelGlyph } from './PixelGlyph'
import { PixelIcon } from './PixelIcon'
import { PixelSpinner } from './PixelSpinner'
import { CloseIcon } from './pixelIcons'
import { PIXEL_GLYPHS, type PixelGlyphName } from './pixelGlyphs'
import { PIXEL_ICON_ART, type PixelIconName } from './pixelIconArt'

afterEach(() => {
  act(() => {
    applyIconSet(DEFAULT_ICON_SET)
  })
})

describe('icon sets', () => {
  it('has a line drawing for every pixel icon and glyph, and no stray ones', () => {
    expect(Object.keys(LINE_ICONS).sort()).toEqual(Object.keys(PIXEL_ICON_ART).sort())
    expect(Object.keys(LINE_GLYPHS).sort()).toEqual(Object.keys(PIXEL_GLYPHS).sort())
    for (const name of Object.keys(LINE_ICONS) as PixelIconName[]) {
      expect(LINE_ICONS[name], name).toBeTruthy()
    }
    for (const name of Object.keys(LINE_GLYPHS) as PixelGlyphName[]) {
      expect(LINE_GLYPHS[name], name).toBeTruthy()
    }
  })

  it('shows pixel art by default and tells the sets apart', () => {
    expect(readIconSet()).toBe('pixel')
    expect(isIconSet('line')).toBe(true)
    expect(isIconSet('sketch')).toBe(false)
    const { container } = render(<PixelIcon name="close" />)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('shape-rendering')).toBe('crispEdges')
    expect(svg.hasAttribute('data-cove-icon-set')).toBe(false)
  })

  it('redraws mounted icons as line icons, keeping their box, name and label', () => {
    const { container } = render(
      <>
        <PixelIcon name="settings" size={24} className="mine" aria-label="Settings" />
        <CloseIcon />
        <PixelGlyph name="terminal" className="kind" data-cove-part="icon" />
        <PixelSpinner size={12} />
      </>,
    )
    expect(container.querySelectorAll('[data-cove-icon-set="line"]')).toHaveLength(0)

    act(() => {
      applyIconSet('line')
    })
    const [settings, close, glyph, spinner] = [...container.querySelectorAll('svg')]
    for (const svg of [settings!, close!, glyph!, spinner!]) {
      expect(svg.getAttribute('data-cove-icon-set')).toBe('line')
      expect(svg.getAttribute('shape-rendering')).toBeNull()
      expect(svg.classList.contains('cove-line-icon')).toBe(true)
    }
    expect(settings!.getAttribute('data-cove-pixel-icon')).toBe('settings')
    expect(settings!.getAttribute('width')).toBe('24')
    expect(settings!.classList.contains('cove-pixel-icon')).toBe(true)
    expect(settings!.classList.contains('mine')).toBe(true)
    expect(settings!.getAttribute('role')).toBe('img')
    expect(settings!.getAttribute('aria-label')).toBe('Settings')
    expect(settings!.hasAttribute('aria-hidden')).toBe(false)
    expect(close!.getAttribute('aria-hidden')).toBe('true')
    expect(close!.getAttribute('width')).toBe('18')
    expect(glyph!.getAttribute('data-cove-pixel-glyph')).toBe('terminal')
    expect(glyph!.getAttribute('data-cove-part')).toBe('icon')
    expect(glyph!.classList.contains('cove-pixel-glyph')).toBe(true)
    expect(spinner!.getAttribute('data-cove-pixel-icon')).toBe('spinner')
    expect(spinner!.classList.contains('cove-line-spinner')).toBe(true)

    act(() => {
      applyIconSet('pixel')
    })
    expect(container.querySelectorAll('[data-cove-icon-set="line"]')).toHaveLength(0)
    expect(container.querySelectorAll('svg[shape-rendering="crispEdges"]')).toHaveLength(4)
  })
})
