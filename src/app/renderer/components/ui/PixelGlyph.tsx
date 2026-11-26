import React, { memo } from 'react'
import { classNames } from './classNames'
import { LINE_GLYPHS } from './lineIcons'
import { LINE_ICON_STROKE } from './PixelIcon'
import type { PixelGlyphName } from './pixelGlyphs'

/**
 * A 9×9 pixel icon in `currentColor`, drawn with crisp edges (Tide: colour always comes with a
 * pixel icon). Decorative: the surrounding title or label names what it shows.
 */
export const PixelGlyph = memo(function PixelGlyph({
  name,
  className,
  ...data
}: {
  name: PixelGlyphName
  className?: string
} & { [key: `data-${string}`]: string | undefined }): React.JSX.Element {
  // CSS sizes a glyph, as it does the pixel art; the library's own size only fills the gap.
  const LineGlyph = LINE_GLYPHS[name]
  return (
    <LineGlyph
      className={classNames('cove-pixel-glyph', 'cove-line-icon', className)}
      strokeWidth={LINE_ICON_STROKE}
      aria-hidden="true"
      focusable="false"
      data-cove-pixel-glyph={name}
      data-cove-icon-set="line"
      {...data}
    />
  )
})
