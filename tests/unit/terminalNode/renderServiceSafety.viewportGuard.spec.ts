import type { Terminal } from '@xterm/xterm'
import { describe, expect, it, vi } from 'vitest'
import { installViewportDetachedRendererGuard } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/renderServiceSafety'

// Mirrors xterm 6 Viewport: each method reads `renderService.dimensions`, which throws once the
// render service has dropped its renderer, and `_sync` sets its reentrancy flag before the read.
function createFakeViewportTerminal() {
  let renderer: { dimensions: { css: { cell: { height: number } } } } | undefined = {
    dimensions: { css: { cell: { height: 10 } } },
  }
  const renderService = {
    hasRenderer: () => renderer !== undefined,
    get dimensions() {
      return renderer!.dimensions
    },
  }
  const viewport = {
    _renderService: renderService,
    _isSyncing: false,
    syncCount: 0,
    _sync(): void {
      if (this._isSyncing) {
        return
      }
      this._isSyncing = true
      void this._renderService.dimensions.css.cell.height
      this.syncCount += 1
      this._isSyncing = false
    },
    _handleScroll: vi.fn(function (this: { _renderService: typeof renderService }) {
      return this._renderService.dimensions.css.cell.height
    }),
    scrollLines: vi.fn(function (this: { _renderService: typeof renderService }) {
      return this._renderService.dimensions.css.cell.height
    }),
    scrollToLine: vi.fn(function (this: { _renderService: typeof renderService }) {
      return this._renderService.dimensions.css.cell.height
    }),
  }
  const terminal = { _core: { _viewport: viewport } } as unknown as Terminal

  return {
    terminal,
    viewport,
    detachRenderer: () => {
      renderer = undefined
    },
    attachRenderer: () => {
      renderer = { dimensions: { css: { cell: { height: 12 } } } }
    },
  }
}

describe('installViewportDetachedRendererGuard', () => {
  it('reports false before the terminal is opened', () => {
    expect(installViewportDetachedRendererGuard({} as Terminal)).toBe(false)
  })

  it('passes viewport calls through while a renderer is attached', () => {
    const { terminal, viewport } = createFakeViewportTerminal()

    expect(installViewportDetachedRendererGuard(terminal)).toBe(true)
    viewport._sync()

    expect(viewport.syncCount).toBe(1)
    expect(viewport.scrollLines(1)).toBe(10)
  })

  it('skips dimension reads while detached and resyncs once a renderer is back', () => {
    const { terminal, viewport, detachRenderer, attachRenderer } = createFakeViewportTerminal()
    installViewportDetachedRendererGuard(terminal)

    detachRenderer()
    expect(() => viewport._sync()).not.toThrow()
    expect(() => viewport._handleScroll({ scrollTop: 40 })).not.toThrow()
    expect(() => viewport.scrollLines(1)).not.toThrow()
    expect(() => viewport.scrollToLine(3, true)).not.toThrow()
    // The reentrancy flag must not be left set, or the viewport never syncs again.
    expect(viewport._isSyncing).toBe(false)
    expect(viewport.syncCount).toBe(0)

    attachRenderer()
    viewport._sync()
    expect(viewport.syncCount).toBe(1)
  })

  it('installs once per viewport', () => {
    const { terminal, viewport } = createFakeViewportTerminal()
    installViewportDetachedRendererGuard(terminal)
    const guardedSync = viewport._sync

    expect(installViewportDetachedRendererGuard(terminal)).toBe(true)
    expect(viewport._sync).toBe(guardedSync)
  })
})
