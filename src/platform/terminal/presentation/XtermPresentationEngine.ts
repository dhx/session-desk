import { SerializeAddon } from '@xterm/addon-serialize'
import { Terminal } from '@xterm/xterm'
import type {
  TerminalPresentationBufferKind,
  TerminalPresentationEngine,
  TerminalPresentationEngineOptions,
} from './TerminalPresentationEngine'

export class XtermPresentationEngine implements TerminalPresentationEngine {
  private readonly terminal: Terminal
  private readonly serializeAddon: SerializeAddon

  public constructor(options: TerminalPresentationEngineOptions) {
    this.terminal = new Terminal({
      allowProposedApi: true,
      convertEol: true,
      cols: options.cols,
      rows: options.rows,
      scrollback: options.scrollback,
    })
    this.serializeAddon = new SerializeAddon()
    this.terminal.loadAddon(this.serializeAddon)
  }

  public get cols(): number {
    return this.terminal.cols
  }

  public get rows(): number {
    return this.terminal.rows
  }

  public write(data: string): Promise<void> {
    return new Promise(resolve => {
      this.terminal.write(data, resolve)
    })
  }

  public resize(cols: number, rows: number): void {
    this.terminal.resize(cols, rows)
  }

  public bufferKind(): TerminalPresentationBufferKind {
    return this.terminal.buffer.active.type ?? 'unknown'
  }

  public cursor(): { x: number; y: number } {
    return { x: this.terminal.buffer.active.cursorX, y: this.terminal.buffer.active.cursorY }
  }

  public serialize(): string {
    return this.serializeAddon.serialize()
  }

  public onTitleChange(listener: (title: string) => void): void {
    this.terminal.onTitleChange(listener)
  }

  public dispose(): void {
    this.terminal.dispose()
  }
}
