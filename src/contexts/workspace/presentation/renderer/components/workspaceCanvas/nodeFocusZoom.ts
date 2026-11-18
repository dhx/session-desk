// Session Desk (#41): focusing a node keeps the whole window visible.
import type { Size } from '../../types'
import { MIN_CANVAS_ZOOM, NODE_FOCUS_VIEWPORT_PADDING_PX } from './constants'

/**
 * Lowers the target zoom just enough for the whole node, plus padding on every side, to fit the
 * visible canvas. It never raises the zoom: a node that already fits lands on the target.
 */
export function resolveNodeFitZoom(
  targetZoom: number,
  nodeSize: Size,
  bounds: Size,
  paddingPx = NODE_FOCUS_VIEWPORT_PADDING_PX,
): number {
  const availableWidth = bounds.width - paddingPx * 2
  const availableHeight = bounds.height - paddingPx * 2
  if (
    availableWidth <= 0 ||
    availableHeight <= 0 ||
    !(nodeSize.width > 0) ||
    !(nodeSize.height > 0)
  ) {
    return targetZoom
  }

  const fitZoom = Math.min(availableWidth / nodeSize.width, availableHeight / nodeSize.height)
  return Math.max(MIN_CANVAS_ZOOM, Math.min(targetZoom, fitZoom))
}

export function resolveBoundsCenter(bounds: {
  left: number
  top: number
  width: number
  height: number
}): { x: number; y: number } | null {
  const x = bounds.left + bounds.width / 2
  const y = bounds.top + bounds.height / 2
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null
  }

  return { x, y }
}
