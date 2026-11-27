/**
 * The app in miniature for the appearance picker, in this fork's plain look (docs/dhx/RELEASES.md):
 * a top bar, the sidebar, the plain canvas and two rounded windows, a task and an agent, with their
 * kind's header colour over a neutral plate. Upstream's miniature (appearanceThumbnail.ts) is pixel
 * art on the pixel wall, which this fork does not show. Colours come from the generated Cove theme,
 * so a palette change reaches the miniature too.
 */
import { toCss } from '@shared/design/oklch'
import { generateFamilyTheme, kindRoles, type Appearance } from '@shared/design/themeGenerator'
import { resolveRoleColors } from '@shared/design/themeTokens'

/** The drawing's own units; the picker scales the whole drawing. */
export const PLAIN_THUMBNAIL_SIZE = { width: 84, height: 56 } as const

/** A filled shape: a rectangle, rounded on all corners (`radius`) or only on top (`top`). */
export interface PlainThumbnailShape {
  part: string
  x: number
  y: number
  width: number
  height: number
  fill: string
  radius?: number
  top?: number
  stroke?: string
}

const { width: W, height: H } = PLAIN_THUMBNAIL_SIZE
const cache = new Map<Appearance, readonly PlainThumbnailShape[]>()

function windowShapes(
  name: string,
  box: { x: number; y: number; width: number; height: number },
  colors: { plate: string; border: string; tile: string; glyph: string },
): PlainThumbnailShape[] {
  return [
    { part: `${name}-window`, ...box, radius: 3, fill: colors.plate, stroke: colors.border },
    { part: `${name}-header`, ...box, height: 7, top: 3, fill: colors.tile },
    {
      part: `${name}-glyph`,
      x: box.x + 3,
      y: box.y + 2,
      width: 3,
      height: 3,
      radius: 1,
      fill: colors.glyph,
    },
  ]
}

/** Every shape of one appearance, back to front. */
export function plainAppearanceThumbnailShapes(
  appearance: Appearance,
): readonly PlainThumbnailShape[] {
  const cached = cache.get(appearance)
  if (cached) {
    return cached
  }
  const theme = generateFamilyTheme('cove', appearance)
  const roles = resolveRoleColors(theme)
  const plan = kindRoles(theme, 'plan')
  const ai = kindRoles(theme, 'ai')
  const frame = toCss(roles.frame)
  const accent = toCss(roles.accent)
  const muted = toCss(roles.textMuted)
  const faint = toCss(roles.textFaint)
  // The plain look's reading plate and hairline: the neutral scale's first and sixth steps.
  const plate = toCss(theme.neutral[0]!)
  const border = toCss(theme.neutral[5]!)
  const line = (part: string, x: number, y: number, width: number, fill: string) =>
    ({ part, x, y, width, height: 2, radius: 1, fill }) satisfies PlainThumbnailShape

  const shapes: PlainThumbnailShape[] = [
    { part: 'canvas', x: 0, y: 0, width: W, height: H, fill: toCss(roles.canvas) },
    { part: 'top-bar', x: 0, y: 0, width: W, height: 7, fill: frame },
    { part: 'top-bar-rule', x: 0, y: 7, width: W, height: 1, fill: border },
    line('top-bar-control', 72, 3, 8, accent),
    { part: 'sidebar', x: 0, y: 8, width: 18, height: H - 8, fill: frame },
    { part: 'sidebar-rule', x: 18, y: 8, width: 1, height: H - 8, fill: border },
    line('sidebar-current', 4, 13, 10, accent),
    line('sidebar-item', 4, 19, 10, faint),
    line('sidebar-item-2', 4, 25, 8, faint),

    ...windowShapes(
      'task',
      { x: 25, y: 13, width: 28, height: 26 },
      { plate, border, tile: toCss(plan.tile), glyph: toCss(plan.glyph) },
    ),
    line('task-text', 29, 24, 17, muted),
    line('task-text-2', 29, 28, 12, muted),
    ...[29, 34, 39, 44].map((x, index) =>
      line(`task-step-${index + 1}`, x, 34, 4, toCss(index < 3 ? plan.solid : plan.line)),
    ),

    ...windowShapes(
      'agent',
      { x: 55, y: 23, width: 26, height: 28 },
      { plate, border, tile: toCss(ai.tile), glyph: toCss(ai.glyph) },
    ),
    line('agent-text', 59, 34, 15, muted),
    line('agent-text-2', 59, 38, 10, muted),
    line('agent-cursor', 59, 42, 4, accent),
  ]
  cache.set(appearance, shapes)
  return shapes
}

/** The SVG path of a shape: a rounded rectangle, or one rounded only on top. */
export function plainThumbnailShapePath(shape: PlainThumbnailShape): string {
  const { x, y, width: w, height: h } = shape
  if (shape.top) {
    const r = shape.top
    return `M${x} ${y + h}V${y + r}Q${x} ${y} ${x + r} ${y}H${x + w - r}Q${x + w} ${y} ${x + w} ${y + r}V${y + h}Z`
  }
  const r = shape.radius ?? 0
  if (r === 0) {
    return `M${x} ${y}h${w}v${h}h-${w}z`
  }
  return (
    `M${x + r} ${y}H${x + w - r}Q${x + w} ${y} ${x + w} ${y + r}V${y + h - r}` +
    `Q${x + w} ${y + h} ${x + w - r} ${y + h}H${x + r}Q${x} ${y + h} ${x} ${y + h - r}` +
    `V${y + r}Q${x} ${y} ${x + r} ${y}Z`
  )
}

/** System: dark to the right of a diagonal from the top right third to the bottom left third. */
export const PLAIN_THUMBNAIL_SYSTEM_SPLIT = `M${W} 0V${H}H${Math.round(W / 3)}L${Math.round((2 * W) / 3)} 0Z`
