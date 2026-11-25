import React, { memo } from 'react'
import { classNames } from './classNames'
import { LoaderCircle } from 'lucide-react'
import { LINE_ICON_STROKE, type PixelIconSize } from './PixelIcon'

/**
 * Busy, in pixels: eight blocks round a ring light up one after another. A pixel icon never
 * rotates, since a quarter turn off the grid smears it (ui-icons.css).
 */
export const PixelSpinner = memo(function PixelSpinner({
  size = 18,
  className,
  ...svgProps
}: Omit<
  React.SVGProps<SVGSVGElement>,
  'children' | 'ref' | 'width' | 'height' | 'viewBox' | 'fill'
> & { size?: PixelIconSize }): React.JSX.Element {
  return (
    <LoaderCircle
      aria-hidden="true"
      focusable="false"
      {...svgProps}
      className={classNames('cove-pixel-icon', 'cove-line-icon', 'cove-line-spinner', className)}
      size={size}
      strokeWidth={LINE_ICON_STROKE}
      data-cove-pixel-icon="spinner"
      data-cove-icon-set="line"
    />
  )
})
