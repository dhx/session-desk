import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PixelIcon, pixelIconPath } from './PixelIcon'
import { PixelSpinner } from './PixelSpinner'
import { LINE_GLYPHS, LINE_ICONS } from './lineIcons'
import { PIXEL_GLYPHS } from './pixelGlyphs'
import * as pixelIcons from './pixelIcons'
import { PIXEL_ICON_ART, PIXEL_ICON_GRID, pixelIconRows, type PixelIconName } from './pixelIconArt'
import { PIXEL_ICON_ART_ACTIONS } from './pixelIconArt/pixelIconArt.actions'
import { PIXEL_ICON_ART_FILES } from './pixelIconArt/pixelIconArt.files'
import { PIXEL_ICON_ART_LAYOUT } from './pixelIconArt/pixelIconArt.layout'
import { PIXEL_ICON_ART_OBJECTS } from './pixelIconArt/pixelIconArt.objects'

const NAMES = Object.keys(PIXEL_ICON_ART) as PixelIconName[]

/** The cells a path of `M{x} {y}h{w}v1h-{w}z` runs paints, as rows of `#` and `.`. */
function cellsOf(path: string): string[] {
  const grid = Array.from({ length: PIXEL_ICON_GRID }, () => Array(PIXEL_ICON_GRID).fill('.'))
  for (const [, x, y, width] of path.matchAll(/M(\d+) (\d+)h(\d+)v1h-\3z/g)) {
    for (let cell = Number(x); cell < Number(x) + Number(width); cell++) {
      grid[Number(y)]![cell] = '#'
    }
  }
  return grid.map(row => row.join(''))
}

describe('pixel icon art', () => {
  it('draws every icon on whole cells of the 12×12 grid', () => {
    for (const name of NAMES) {
      const rows = pixelIconRows(name)
      expect(rows, name).toHaveLength(PIXEL_ICON_GRID)
      for (const row of rows) {
        expect(row, name).toMatch(/^[#.]{12}$/)
      }
      expect(rows.join(''), `${name} paints nothing`).toContain('#')
    }
  })

  it('gives each meaning its own name and its own art', () => {
    const groups = [
      PIXEL_ICON_ART_ACTIONS,
      PIXEL_ICON_ART_LAYOUT,
      PIXEL_ICON_ART_FILES,
      PIXEL_ICON_ART_OBJECTS,
    ]
    // A name in two groups would silently lose one drawing to the other.
    expect(groups.reduce((count, group) => count + Object.keys(group).length, 0)).toBe(NAMES.length)
    const owners = new Map<string, PixelIconName>()
    for (const name of NAMES) {
      const art = pixelIconRows(name).join('\n')
      expect(owners.get(art), `${name} repeats another icon`).toBeUndefined()
      owners.set(art, name)
    }
  })

  it('paints exactly the art as one path of runs', () => {
    for (const name of NAMES) {
      const path = pixelIconPath(name)
      expect(path, name).toMatch(/^(M\d+ \d+h\d+v1h-\d+z)+$/)
      expect(cellsOf(path), name).toEqual(pixelIconRows(name))
    }
  })
})

describe('PixelIcon', () => {
  it("is a decorative line icon at a grid size, under the pixel icon's name (this fork)", () => {
    const { container } = render(<PixelIcon name="close" className="extra" />)
    const svg = container.querySelector('svg')!
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg).not.toHaveAttribute('role')
    expect(svg).toHaveClass('cove-pixel-icon', 'extra')
    expect(svg).toHaveAttribute('width', '18')
    expect(svg).toHaveAttribute('height', '18')
    expect(svg).toHaveClass('cove-line-icon')
    expect(svg).toHaveAttribute('data-cove-icon-set', 'line')
    expect(svg).not.toHaveAttribute('shape-rendering')
    expect(svg).toHaveAttribute('stroke', 'currentColor')
    expect(svg).toHaveAttribute('data-cove-pixel-icon', 'close')
  })

  it('becomes an image when it is given a label', () => {
    const { container } = render(<PixelIcon name="warning" size={24} aria-label="Warning" />)
    const svg = container.querySelector('svg')!
    expect(svg).toHaveAttribute('role', 'img')
    expect(svg).not.toHaveAttribute('aria-hidden')
    expect(svg).toHaveAttribute('width', '24')
  })

  it('exports a component for each icon that draws the icon it is named after', () => {
    const exported = Object.entries(pixelIcons)
    expect(exported.length).toBe(NAMES.length)
    const drawn = new Set<string>()
    for (const [exportName, Icon] of exported) {
      const { container, unmount } = render(<Icon size={12} />)
      const name = container.querySelector('svg')!.getAttribute('data-cove-pixel-icon')!
      expect(NAMES, exportName).toContain(name)
      expect(container.querySelector('svg'), exportName).toHaveAttribute('width', '12')
      drawn.add(name)
      unmount()
    }
    expect(drawn.size).toBe(NAMES.length)
  })
})

describe('PixelSpinner', () => {
  it('is a turning line spinner at a grid size (this fork)', () => {
    const { container } = render(<PixelSpinner size={12} />)
    const svg = container.querySelector('svg')!
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg).toHaveClass('cove-pixel-icon', 'cove-line-icon', 'cove-line-spinner')
    expect(svg).toHaveAttribute('width', '12')
    expect(svg).toHaveAttribute('data-cove-pixel-icon', 'spinner')
    expect(svg.querySelectorAll('rect')).toHaveLength(0)
  })
})

describe('line drawings (this fork)', () => {
  it('exist for every pixel icon and every kind glyph, and for nothing else', () => {
    expect(Object.keys(LINE_ICONS).sort()).toEqual(Object.keys(PIXEL_ICON_ART).sort())
    expect(Object.keys(LINE_GLYPHS).sort()).toEqual(Object.keys(PIXEL_GLYPHS).sort())
  })
})
