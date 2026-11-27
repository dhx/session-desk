import { describe, expect, it } from 'vitest'
import { toCss } from '@shared/design/oklch'
import { generateFamilyTheme, kindRoles } from '@shared/design/themeGenerator'
import { resolveRoleColors } from '@shared/design/themeTokens'
import {
  PLAIN_THUMBNAIL_SIZE,
  PLAIN_THUMBNAIL_SYSTEM_SPLIT,
  plainAppearanceThumbnailShapes,
  plainThumbnailShapePath,
} from './plainAppearanceThumbnail'

const { width: W, height: H } = PLAIN_THUMBNAIL_SIZE

describe('plain appearance thumbnail (this fork)', () => {
  it.each(['dark', 'light'] as const)(
    'draws the %s app from the generated Cove colours, on a plain canvas with neutral plates',
    appearance => {
      const theme = generateFamilyTheme('cove', appearance)
      const roles = resolveRoleColors(theme)
      const shapes = plainAppearanceThumbnailShapes(appearance)
      const fill = (part: string) => shapes.find(shape => shape.part === part)?.fill
      expect(shapes[0]).toMatchObject({ part: 'canvas', x: 0, y: 0, width: W, height: H })
      expect(fill('canvas')).toBe(toCss(roles.canvas))
      expect(fill('top-bar')).toBe(toCss(roles.frame))
      expect(fill('sidebar-current')).toBe(toCss(roles.accent))
      // Windows keep their kind's header colour over the same neutral plate.
      expect(fill('task-header')).toBe(toCss(kindRoles(theme, 'plan').tile))
      expect(fill('agent-header')).toBe(toCss(kindRoles(theme, 'ai').tile))
      expect(fill('task-window')).toBe(toCss(theme.neutral[0]!))
      expect(fill('agent-window')).toBe(fill('task-window'))
      expect(fill('task-window')).not.toBe(toCss(kindRoles(theme, 'plan').plate))
      // No pixel wall: nothing is painted in the wall's cell colour.
      expect(shapes.map(shape => shape.fill)).not.toContain(toCss(theme.pixel.cell))
    },
  )

  it('keeps every shape inside the drawing, with unique part names', () => {
    for (const appearance of ['dark', 'light'] as const) {
      const shapes = plainAppearanceThumbnailShapes(appearance)
      expect(new Set(shapes.map(shape => shape.part)).size).toBe(shapes.length)
      for (const shape of shapes) {
        expect(shape.x, shape.part).toBeGreaterThanOrEqual(0)
        expect(shape.y, shape.part).toBeGreaterThanOrEqual(0)
        expect(shape.x + shape.width, shape.part).toBeLessThanOrEqual(W)
        expect(shape.y + shape.height, shape.part).toBeLessThanOrEqual(H)
      }
    }
    expect(plainAppearanceThumbnailShapes('dark')).toBe(plainAppearanceThumbnailShapes('dark'))
  })

  it('writes square, rounded and top-rounded shapes as closed paths', () => {
    const base = { part: 'p', x: 2, y: 4, width: 10, height: 6, fill: '#000' }
    expect(plainThumbnailShapePath(base)).toBe('M2 4h10v6h-10z')
    expect(plainThumbnailShapePath({ ...base, radius: 2 })).toBe(
      'M4 4H10Q12 4 12 6V8Q12 10 10 10H4Q2 10 2 8V6Q2 4 4 4Z',
    )
    expect(plainThumbnailShapePath({ ...base, top: 2 })).toBe('M2 10V6Q2 4 4 4H10Q12 4 12 6V10Z')
    expect(PLAIN_THUMBNAIL_SYSTEM_SPLIT).toBe(`M${W} 0V${H}H28L56 0Z`)
  })
})
