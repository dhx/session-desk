import { afterEach, describe, expect, it, vi } from 'vitest'
import { Terminal } from '@xterm/xterm'
import { createTerminalHydrationRouter } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/hydrationRouter'

const terminals: Terminal[] = []

afterEach(() => {
  terminals.splice(0).forEach(terminal => terminal.dispose())
})

function createHarness(placeholder = false) {
  const terminal = new Terminal({ cols: 80, rows: 24, allowProposedApi: true })
  terminals.push(terminal)
  const input: string[] = []
  terminal.onData(data => input.push(data))
  terminal.onBinary(data => input.push(data))
  const buffer = { set: vi.fn(), append: vi.fn(), snapshot: () => '' }
  const router = createTerminalHydrationRouter({
    terminal,
    outputScheduler: { handleChunk: data => terminal.write(data) },
    shouldReplaceAgentPlaceholderAfterHydration: () => placeholder,
    shouldReplaceAuthoritativeBaselineWithBufferedOutput: () => true,
    shouldDeferHydratedRedrawChunks: () => false,
    scrollbackBuffer: buffer,
    committedScrollbackBuffer: buffer,
    recordCommittedScreenState: vi.fn(),
    scheduleTranscriptSync: vi.fn(),
    ptyWriteQueue: { flush: vi.fn() },
    markScrollbackDirty: vi.fn(),
    logHydrated: vi.fn(),
    syncTerminalSize: vi.fn(),
    onRevealed: vi.fn(),
    isDisposed: () => false,
  })
  const drain = () => new Promise<void>(resolve => terminal.write('', resolve))
  const mouseReport = (button: number, action: number): string => {
    input.length = 0
    // Exercise the pinned xterm encoder without requiring DOM layout in this regression layer.
    const core = terminal as unknown as {
      _core: {
        coreMouseService: {
          triggerMouseEvent: (event: {
            col: number
            row: number
            x: number
            y: number
            button: number
            action: number
            ctrl: boolean
            alt: boolean
            shift: boolean
          }) => boolean
        }
      }
    }
    core._core.coreMouseService.triggerMouseEvent({
      col: 2,
      row: 3,
      x: 20,
      y: 40,
      button,
      action,
      ctrl: false,
      alt: false,
      shift: false,
    })
    return input.join('')
  }
  return {
    terminal,
    router,
    input,
    drain,
    wheel: () => mouseReport(4, 1),
    move: () => mouseReport(3, 32),
  }
}

describe('hydrationRouter input modes', () => {
  it.each([false, true])(
    'keeps SGR mouse reports after baseline replacement regardless of chunking (split=%s)',
    async split => {
      const { router, drain, wheel, move } = createHarness()
      const encoding = '\u001b[?1006h'
      const frame = '\u001b[2J\u001b[?1003hCodex ready'
      for (const chunk of split ? [encoding, frame] : [encoding + frame]) {
        router.handleDataChunk(chunk)
      }
      router.finalizeHydration('[startup baseline]')
      await drain()
      expect(wheel()).toBe('\u001b[<65;3;4M')
      expect(move()).toBe('\u001b[<35;3;4M')
    },
  )

  it('restores early mouse, focus and paste modes without answering queries twice', async () => {
    const { terminal, router, input, drain, wheel } = createHarness()
    router.handleDataChunk('\u001b[?1006;1004;2004h', { seq: 3 })
    router.handleDataChunk('\u001b[c', { seq: 4 })
    router.handleDataChunk('\u001b[2J\u001b[?1003hCodex ready', { seq: 6 })
    router.finalizeHydration('[accepted snapshot]', { baselineAppliedSeq: 5 })
    await drain()
    expect(input.filter(data => data.endsWith('c'))).toHaveLength(1)
    expect(terminal.modes.bracketedPasteMode).toBe(true)
    expect(wheel()).toBe('\u001b[<65;3;4M')
  })

  it('keeps mode changes in order across a deferred placeholder reset', async () => {
    const { terminal, router, drain, wheel } = createHarness(true)
    router.handleDataChunk('\u001b[?1006;2004h')
    router.finalizeHydration('[placeholder]')
    router.handleDataChunk('\u001b[?1003h')
    router.handleDataChunk('\u001b[2JCodex ready')
    await drain()
    expect(terminal.modes.bracketedPasteMode).toBe(true)
    expect(wheel()).toBe('\u001b[<65;3;4M')
  })

  it('honors a later disable instead of resurrecting an earlier enabled mode', async () => {
    const { terminal, router, drain, wheel } = createHarness(true)
    router.handleDataChunk('\u001b[?1006;2004h')
    router.finalizeHydration('[placeholder]')
    router.handleDataChunk('\u001b[?1006;2004l')
    router.handleDataChunk('\u001b[2J\u001b[?1003hCodex ready')
    await drain()
    expect(terminal.modes.bracketedPasteMode).toBe(false)
    expect(wheel().startsWith('\u001b[M')).toBe(true)
  })

  it('retains early modes when the buffered output already matches the placeholder', async () => {
    const { router, drain, wheel } = createHarness(true)
    router.handleDataChunk('\u001b[?1006h')
    router.handleDataChunk('Codex ready')
    router.finalizeHydration('\u001b[?1006hCodex ready')
    router.handleDataChunk('\u001b[2J\u001b[?1003hFresh frame')
    await drain()
    expect(wheel()).toBe('\u001b[<65;3;4M')
  })

  it('does not replay stale modes after a control-only redraw buffer', async () => {
    const { terminal, router, drain, wheel } = createHarness()
    router.handleDataChunk('\u001b[?1006;2004h')
    router.finalizeHydration('[accepted snapshot]')
    router.handleDataChunk('\u001b[?1006;2004l')
    router.handleDataChunk('\u001b[?1003h')
    router.handleDataChunk('Codex ready')
    await drain()
    expect(terminal.modes.bracketedPasteMode).toBe(false)
    expect(wheel().startsWith('\u001b[M')).toBe(true)
  })
})

it('preserves an embedded mode before a later destructive placeholder replacement', async () => {
  const { router, drain, wheel } = createHarness(true)
  router.handleDataChunk('Codex ready')
  router.finalizeHydration('Codex ready')
  router.handleDataChunk('\u001b[?1006hWaiting')
  router.handleDataChunk('\u001b[2J\u001b[?1003hFresh frame')
  await drain()
  expect(wheel()).toBe('\u001b[<65;3;4M')
})
it('preserves embedded modes discarded by the baseline sequence cutoff', async () => {
  const { router, drain, wheel } = createHarness()
  router.handleDataChunk('\u001b[?1006hOld frame', { seq: 3 })
  router.handleDataChunk('\u001b[2J\u001b[?1003hFresh frame', { seq: 6 })
  router.finalizeHydration('[accepted snapshot]', { baselineAppliedSeq: 5 })
  await drain()
  expect(wheel()).toBe('\u001b[<65;3;4M')
})

it.each([0, 1, 2, 3, 4, 5, 6, 7, 8])(
  'preserves a fragmented embedded mode at split %s across a sequence cutoff',
  async split => {
    const { router, drain, wheel } = createHarness()
    const encoding = '\u001b[?1006h'
    router.handleDataChunk('old' + encoding.slice(0, split), { seq: 2 })
    router.handleDataChunk(encoding.slice(split) + ' frame', { seq: 3 })
    router.handleDataChunk('\u001b[2J\u001b[?1003hFresh frame', { seq: 6 })
    router.finalizeHydration('[accepted snapshot]', { baselineAppliedSeq: 5 })
    await drain()
    expect(wheel()).toBe('\u001b[<65;3;4M')
  },
)
it('keeps a later embedded disable after replacing a placeholder', async () => {
  const { terminal, router, drain, wheel } = createHarness(true)
  router.handleDataChunk('Codex ready')
  router.finalizeHydration('Codex ready')
  router.handleDataChunk('\u001b[?1006;2004hWaiting')
  router.handleDataChunk('\u001b[?1006;2004lDisabled')
  router.handleDataChunk('\u001b[2J\u001b[?1003hFresh frame')
  await drain()
  expect(terminal.modes.bracketedPasteMode).toBe(false)
  expect(wheel().startsWith('\u001b[M')).toBe(true)
})
it('honors an application full reset before replacement', async () => {
  const { router, drain, wheel } = createHarness(true)
  router.handleDataChunk('Codex ready')
  router.finalizeHydration('Codex ready')
  router.handleDataChunk('\u001b[?1006hWaiting\u001bc')
  router.handleDataChunk('\u001b[2J\u001b[?1003hFresh frame')
  await drain()
  expect(wheel().startsWith('\u001b[M')).toBe(true)
})

it.each([true, false])(
  'honors authoritative snapshot modes and later live updates (liveDisable=%s)',
  async liveDisable => {
    const { router, drain, wheel } = createHarness()
    router.handleDataChunk('\u001b[?1006hOld frame', { seq: 3 })
    router.handleDataChunk(
      '\u001b[2J\u001b[?1003hFresh frame' + (liveDisable ? '\u001b[?1006l' : ''),
      { seq: 6 },
    )
    router.finalizeHydration('snapshot\u001b[?1006' + (liveDisable ? 'h' : 'l'), {
      baselineAppliedSeq: 5,
    })
    await drain()
    expect(wheel().startsWith('\u001b[M')).toBe(true)
  },
)

it.each([
  ['\u001b[', '31mRED'],
  ['\u001b]0;ti', 'tle\u0007RED'],
  ['\u001bPq', 'payload\u001b\\RED'],
])(
  'does not splice replay controls into an incomplete display sequence %j',
  async (pending, continuation) => {
    const { terminal, router, drain } = createHarness()
    router.handleDataChunk('\u001b[?1006h', { seq: 3 })
    router.handleDataChunk('\u001b[2J\u001b[?1003hFresh' + pending, { seq: 6 })
    router.finalizeHydration('[accepted snapshot]', { baselineAppliedSeq: 5 })
    router.handleDataChunk(continuation)
    await drain()
    expect(terminal.buffer.active.getLine(0)?.translateToString(true)).toBe('FreshRED')
  },
)
