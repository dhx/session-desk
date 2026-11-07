import { Unicode11Addon } from '@xterm/addon-unicode11'
import { Terminal } from '@xterm/xterm'
import { describe, expect, it } from 'vitest'
import type { TerminalPresentationEngineKind } from '../../../../src/platform/terminal/presentation/TerminalPresentationEngine'
import { createTerminalPresentationEngine } from '../../../../src/platform/terminal/presentation/createTerminalPresentationEngine'
import { LibghosttyPresentationEngine } from '../../../../src/platform/terminal/presentation/libghostty/LibghosttyPresentationEngine'
import { TerminalPresentationSession } from '../../../../src/platform/terminal/presentation/TerminalPresentationSession'

// Invariant: replaying an engine's serialized screen into a fresh xterm (what the
// renderer does on hydration) gives the same screen as feeding xterm the raw
// stream. Both engines must hold it.

const COLS = 80
const ROWS = 24

function rendererTerminal(): Terminal {
  const terminal = new Terminal({
    allowProposedApi: true,
    cols: COLS,
    rows: ROWS,
    scrollback: 5_000,
  })
  terminal.loadAddon(new Unicode11Addon())
  terminal.unicode.activeVersion = '11'
  return terminal
}

function write(terminal: Terminal, data: string): Promise<void> {
  return new Promise(resolve => terminal.write(data, resolve))
}

function rows(terminal: Terminal, which: 'normal' | 'alternate'): string[] {
  const buffer = terminal.buffer[which]
  const lines: string[] = []
  for (let index = 0; index < buffer.length; index += 1) {
    lines.push(buffer.getLine(index)?.translateToString(true) ?? '')
  }
  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop()
  }
  return lines
}

// xterm has no public accessor for the mouse encoding (1005/1006/1015/1016).
function mouseEncoding(terminal: Terminal): string {
  return (terminal as unknown as { _core: { coreMouseService: { activeEncoding: string } } })._core
    .coreMouseService.activeEncoding
}

function mouse(terminal: Terminal) {
  return { tracking: terminal.modes.mouseTrackingMode, encoding: mouseEncoding(terminal) }
}

// Mutually exclusive modes where the last one set wins, set against the
// numeric order an engine might emit them in.
const lastSetWins: Array<[string, string]> = [
  ['button tracking after drag tracking', '\u001b[?1002h\u001b[?1000h'],
  ['button tracking after any-event tracking', '\u001b[?1003h\u001b[?1000h'],
  ['SGR encoding after urxvt encoding', '\u001b[?1000h\u001b[?1015h\u001b[?1006h'],
  ['UTF-8 encoding after SGR encoding', '\u001b[?1000h\u001b[?1006h\u001b[?1005h'],
]

function state(terminal: Terminal) {
  return {
    buffer: terminal.buffer.active.type,
    cursor: [terminal.buffer.active.cursorX, terminal.buffer.active.cursorY],
    mouse: terminal.modes.mouseTrackingMode,
    bracketedPaste: terminal.modes.bracketedPasteMode,
    applicationCursorKeys: terminal.modes.applicationCursorKeysMode,
    normal: rows(terminal, 'normal'),
    alternate: rows(terminal, 'alternate'),
  }
}

async function replayThrough(
  kind: TerminalPresentationEngineKind,
  chunks: string[],
): Promise<{ direct: Terminal; replay: Terminal }> {
  const direct = rendererTerminal()
  const engine = createTerminalPresentationEngine(
    { cols: COLS, rows: ROWS, scrollback: 5_000 },
    kind,
  )
  // Chunks must arrive in order, as they do from the PTY.
  await chunks.reduce(
    (previous, chunk) =>
      previous.then(async () => {
        await write(direct, chunk)
        await engine.write(chunk)
      }),
    Promise.resolve(),
  )
  const replay = rendererTerminal()
  await write(replay, engine.serialize())
  engine.dispose()
  return { direct, replay }
}

const history = Array.from(
  { length: 300 },
  (_, index) => `\u001b[3${index % 8}mline ${index}\u001b[0m ${'x'.repeat(index % 70)}\r\n`,
).join('')
const inputModes = '\u001b[?1000h\u001b[?1002h\u001b[?1006h\u001b[?2004h\u001b[?1h'
const tui =
  '\u001b[?1049h\u001b[H\u001b[2J' +
  Array.from(
    { length: ROWS - 1 },
    (_, row) => `\u001b[${row + 1};1H\u001b[44m TUI ${row} \u001b[0m`,
  ).join('') +
  '\u001b[?1000h\u001b[?1006h'

describe.each<TerminalPresentationEngineKind>(['xterm', 'libghostty'])(
  'presentation engine replay (%s)',
  kind => {
    it('selects the requested engine', () => {
      const engine = createTerminalPresentationEngine(
        { cols: COLS, rows: ROWS, scrollback: 10 },
        kind,
      )
      expect(engine instanceof LibghosttyPresentationEngine).toBe(kind === 'libghostty')
      engine.dispose()
    })

    it('replays scrollback, colours, cursor and input modes', async () => {
      const { direct, replay } = await replayThrough(kind, [history, 'prompt$ ', inputModes])
      expect(state(replay)).toEqual(state(direct))
      const first = (terminal: Terminal) =>
        terminal.buffer.normal.getLine(3)?.getCell(0)?.getFgColor()
      expect(first(replay)).toBe(first(direct))
    })

    it('keeps the shell history underneath an alternate-screen TUI', async () => {
      const { direct, replay } = await replayThrough(kind, [history, tui])
      expect(state(replay)).toEqual(state(direct))

      await write(direct, '\u001b[?1049l')
      await write(replay, '\u001b[?1049l')
      expect(state(replay)).toEqual(state(direct))
    })

    it('applies an escape sequence split across output chunks', async () => {
      const { direct, replay } = await replayThrough(kind, [
        'abc\u001b[38;2;255;1',
        '28;0mORANGE\u001b[0m\r\n',
      ])
      expect(state(replay)).toEqual(state(direct))
      const cell = (terminal: Terminal) =>
        terminal.buffer.normal.getLine(0)?.getCell(3)?.getFgColor()
      expect(cell(replay)).toBe(0xff8000)
      expect(cell(direct)).toBe(0xff8000)
    })

    it.each(lastSetWins)('hydrates the mode set last: %s', async (_name, modes) => {
      const direct = rendererTerminal()
      await write(direct, modes)
      const engine = createTerminalPresentationEngine(
        { cols: COLS, rows: ROWS, scrollback: 5_000 },
        kind,
      )
      const session = new TerminalPresentationSession({ sessionId: 's', engine })
      await session.applyOutput(1, modes)
      const replay = rendererTerminal()
      await write(replay, (await session.snapshot()).serializedScreen)
      session.dispose()

      expect(mouse(replay)).toEqual(mouse(direct))
    })

    it.each([
      ['CJK', '漢字かな'],
      ['emoji', '😀'],
      ['ZWJ sequence', '👩‍💻'],
      ['variation selector', '❤️'],
      ['combining mark', 'é'],
    ])('lands the cursor where xterm does after %s', async (_name, text) => {
      const { direct, replay } = await replayThrough(kind, [`\u001b[H${text}|`])
      expect(state(replay)).toEqual(state(direct))
    })
  },
)

// Why TerminalPresentationSession appends its own input-mode replay to the
// libghostty serialization: the formatter emits modes in a fixed order. If this
// starts failing, libghostty keeps the order and the replay may be redundant.
describe('libghostty formatter mode order', () => {
  it('loses which mutually exclusive mode was set last', async () => {
    const direct = rendererTerminal()
    const modes = '\u001b[?1002h\u001b[?1000h'
    await write(direct, modes)
    const engine = createTerminalPresentationEngine(
      { cols: COLS, rows: ROWS, scrollback: 5_000 },
      'libghostty',
    )
    await engine.write(modes)
    const replay = rendererTerminal()
    await write(replay, engine.serialize())
    engine.dispose()

    expect(direct.modes.mouseTrackingMode).toBe('vt200')
    expect(replay.modes.mouseTrackingMode).toBe('drag')
  })
})
