import React from 'react'
import { render } from '@testing-library/react'
import { expect, it } from 'vitest'
import { PixelGlyph } from '@app/renderer/components/ui/PixelGlyph'
import {
  PIXEL_GLYPHS,
  pixelGlyphRuns,
  type PixelGlyphName,
} from '@app/renderer/components/ui/pixelGlyphs'

it('keeps every 9×9 glyph on its grid, and renders each as a decorative line icon (this fork)', () => {
  for (const name of Object.keys(PIXEL_GLYPHS) as PixelGlyphName[]) {
    const rows = PIXEL_GLYPHS[name]
    expect(rows).toHaveLength(9)
    const expected: string[] = []
    rows.forEach((row, y) => {
      expect(row).toMatch(/^[.#]{9}$/)
      Array.from(row).forEach((cell, x) => {
        if (cell === '#') {
          expected.push(`${x},${y}`)
        }
      })
    })
    const runs = pixelGlyphRuns(name)
    const actual = runs.flatMap(({ x, y, width }) => {
      expect(Number.isInteger(width) && width > 0).toBe(true)
      return Array.from({ length: width }, (_, offset) => `${x + offset},${y}`)
    })
    expect(actual).toEqual(expected)

    const { container, unmount } = render(<PixelGlyph name={name} className="test-glyph" />)
    const svg = container.querySelector('svg')!
    expect(svg).toHaveClass('cove-pixel-glyph', 'test-glyph')
    expect(svg).toHaveAttribute('data-cove-pixel-glyph', name)
    expect(svg).toHaveClass('cove-line-icon')
    expect(svg).toHaveAttribute('data-cove-icon-set', 'line')
    expect(svg).not.toHaveAttribute('shape-rendering')
    expect(svg).toHaveAttribute('stroke', 'currentColor')
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg).toHaveAttribute('focusable', 'false')
    expect(svg).not.toHaveAttribute('tabindex')
    expect(svg.querySelectorAll('rect[height="1"]')).toHaveLength(0)
    unmount()
  }
})
