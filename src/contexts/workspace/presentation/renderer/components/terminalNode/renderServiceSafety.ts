import type { Terminal } from '@xterm/xterm'
import type { FitAddon } from '@xterm/addon-fit'

export type TerminalRenderDimensions = {
  css?: {
    canvas?: { width?: number; height?: number }
    cell?: { width?: number; height?: number }
  }
  device?: {
    canvas?: { width?: number; height?: number }
  }
}

const pendingDetachedRendererReads = new WeakSet<Terminal>()

export function simulateDetachedTerminalRendererReadOnceForTests(terminal: Terminal): void {
  pendingDetachedRendererReads.add(terminal)
}

export function hasPendingDetachedTerminalRendererReadForTests(terminal: Terminal): boolean {
  return pendingDetachedRendererReads.has(terminal)
}

export function clearPendingDetachedTerminalRendererReadForTests(terminal: Terminal): void {
  pendingDetachedRendererReads.delete(terminal)
}

type InternalTerminal = Terminal & {
  _core?: {
    _renderService?: {
      dimensions?: TerminalRenderDimensions
    }
  }
}

function resolveErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

export function isTerminalRenderServiceDetachedError(error: unknown): boolean {
  if (!(error instanceof TypeError)) {
    return false
  }

  const message = resolveErrorMessage(error)
  return (
    message.includes('dimensions') && (message.includes('undefined') || message.includes('null'))
  )
}

export function readTerminalRenderDimensionsSafely(
  terminal: Terminal,
): TerminalRenderDimensions | null {
  if (pendingDetachedRendererReads.delete(terminal)) {
    return null
  }

  try {
    return ((terminal as InternalTerminal)._core?._renderService?.dimensions ??
      null) as TerminalRenderDimensions | null
  } catch (error) {
    if (isTerminalRenderServiceDetachedError(error)) {
      return null
    }

    throw error
  }
}

export function runTerminalRenderMutationSafely(mutation: () => void): boolean {
  try {
    mutation()
    return true
  } catch (error) {
    if (isTerminalRenderServiceDetachedError(error)) {
      return false
    }

    throw error
  }
}

// xterm's Viewport reads `renderService.dimensions` (a non-null assertion on the renderer) from
// animation-frame and scroll callbacks. RenderService drops its renderer when it is disposed, and a
// frame already queued then throws an uncaught TypeError. `_sync` and `_handleScroll` also set a
// reentrancy flag before that read, so a throw leaves the viewport permanently unsynced. Skipping
// the call while no renderer is attached is the only safe option; the next resize, scroll or
// buffer switch resyncs once a renderer is back. Upstream: xtermjs/xterm.js#5011.
const VIEWPORT_DIMENSION_READERS = [
  '_sync',
  '_handleScroll',
  'scrollLines',
  'scrollToLine',
] as const

type XtermViewportInternals = {
  _renderService?: { hasRenderer?: () => boolean }
  __opencoveDetachedRendererGuard?: boolean
} & Partial<Record<(typeof VIEWPORT_DIMENSION_READERS)[number], (...args: unknown[]) => unknown>>

export function installViewportDetachedRendererGuard(terminal: Terminal): boolean {
  const viewport = (terminal as Terminal & { _core?: { _viewport?: XtermViewportInternals } })._core
    ?._viewport
  if (!viewport) {
    return false
  }
  if (viewport.__opencoveDetachedRendererGuard) {
    return true
  }

  for (const method of VIEWPORT_DIMENSION_READERS) {
    const original = viewport[method]
    if (typeof original !== 'function') {
      continue
    }

    viewport[method] = function guardedViewportDimensionReader(
      this: XtermViewportInternals,
      ...args: unknown[]
    ) {
      if (this._renderService?.hasRenderer?.() === false) {
        return undefined
      }

      return original.apply(this, args)
    }
  }

  viewport.__opencoveDetachedRendererGuard = true
  return true
}

export function installFitAddonDetachedRendererGuard(fitAddon: FitAddon): void {
  if (typeof fitAddon.proposeDimensions !== 'function') {
    return
  }

  const proposeDimensions = fitAddon.proposeDimensions.bind(fitAddon)
  fitAddon.proposeDimensions = () => {
    try {
      return proposeDimensions() ?? undefined
    } catch (error) {
      if (isTerminalRenderServiceDetachedError(error)) {
        return undefined
      }

      throw error
    }
  }
}
