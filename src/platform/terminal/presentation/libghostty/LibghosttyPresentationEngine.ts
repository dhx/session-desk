import type {
  TerminalPresentationBufferKind,
  TerminalPresentationEngine,
  TerminalPresentationEngineOptions,
} from '../TerminalPresentationEngine'
import {
  FORMATTER_EXTRAS_ALL,
  FORMATTER_EXTRA_MODES,
  type LibghosttyTerminal,
  type LibghosttyVt,
} from './LibghosttyVt'

// Generous byte cap; the line cap from the session options is the one that binds.
const SCROLLBACK_MAX_BYTES = 64 * 1024 * 1024
// Large enough for any unfinished control string we expect between chunks.
const CONTINUATION_MAX_BYTES = 1024 * 1024

const ENTER_ALTERNATE_SCREEN = '\u001b[?1049h\u001b[H\u001b[2J'
const LEAVE_ALTERNATE_SCREEN = '\u001b[?1049l'

export class LibghosttyPresentationEngine implements TerminalPresentationEngine {
  private readonly terminal: LibghosttyTerminal
  private readonly titleListeners: Array<(title: string) => void> = []
  private currentCols: number
  private currentRows: number
  private lastTitle = ''

  public constructor(vt: LibghosttyVt, options: TerminalPresentationEngineOptions) {
    this.currentCols = options.cols
    this.currentRows = options.rows
    this.terminal = vt.createTerminal({
      cols: options.cols,
      rows: options.rows,
      scrollbackLines: options.scrollback,
      scrollbackBytes: SCROLLBACK_MAX_BYTES,
      continuationBytes: CONTINUATION_MAX_BYTES,
    })
  }

  public get cols(): number {
    return this.currentCols
  }

  public get rows(): number {
    return this.currentRows
  }

  public write(data: string): Promise<void> {
    // libghostty-vt parses synchronously; the session's queue keeps ordering.
    this.terminal.write(data)
    this.emitTitleIfChanged()
    return Promise.resolve()
  }

  public resize(cols: number, rows: number): void {
    this.terminal.resize(cols, rows)
    this.currentCols = cols
    this.currentRows = rows
  }

  public bufferKind(): TerminalPresentationBufferKind {
    return this.terminal.isAlternateScreen() ? 'alternate' : 'normal'
  }

  public cursor(): { x: number; y: number } {
    return this.terminal.cursor()
  }

  public serialize(): string {
    if (!this.terminal.isAlternateScreen()) {
      return this.terminal.formatVt(FORMATTER_EXTRAS_ALL)
    }

    // The formatter only emits the active screen. While a TUI holds the
    // alternate screen, recover the shell history underneath from a copy that
    // leaves it, then replay the alternate screen (and the modes) on top.
    const primary = this.terminal.clone()
    try {
      primary.write(LEAVE_ALTERNATE_SCREEN)
      const primaryVt = primary.formatVt(FORMATTER_EXTRAS_ALL & ~FORMATTER_EXTRA_MODES)
      return primaryVt + ENTER_ALTERNATE_SCREEN + this.terminal.formatVt(FORMATTER_EXTRAS_ALL)
    } finally {
      primary.free()
    }
  }

  public onTitleChange(listener: (title: string) => void): void {
    this.titleListeners.push(listener)
  }

  public dispose(): void {
    this.titleListeners.length = 0
    this.terminal.free()
  }

  private emitTitleIfChanged(): void {
    if (this.titleListeners.length === 0) {
      return
    }
    const title = this.terminal.title()
    if (title === this.lastTitle) {
      return
    }
    this.lastTitle = title
    for (const listener of this.titleListeners) {
      listener(title)
    }
  }
}
