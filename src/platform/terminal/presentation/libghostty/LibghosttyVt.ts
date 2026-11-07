import { readFileSync } from 'node:fs'

// Thin binding over the libghostty-vt 1.0 C ABI compiled to wasm32-freestanding.
// Every handle is opaque, results are GhosttyResult codes (0 = success), and
// out-values go through wasm memory. Views are re-created after each call
// because memory growth detaches earlier ArrayBuffers.

const RESULT_SUCCESS = 0
const RESULT_NO_VALUE = -4

const OPT_SCROLLBACK_MAX_BYTES = 28
const OPT_SCROLLBACK_MAX_LINES = 29
const OPT_CONTINUATION_MAX_BYTES = 32
const OPT_MODE_DEFAULT = 34

const DATA_CURSOR_X = 3
const DATA_CURSOR_Y = 4
const DATA_ACTIVE_SCREEN = 6
const DATA_TITLE = 12

const FORMATTER_OPT_EMIT = 1
const FORMATTER_OPT_TRIM = 3
const FORMATTER_OPT_EXTRAS = 5
const FORMATTER_FORMAT_VT = 1

export const FORMATTER_EXTRA_MODES = 1 << 1
export const FORMATTER_EXTRAS_ALL = 0xfff

const MODE_LINEFEED = 20 | (1 << 15)

// Cell pixel size only feeds pixel-based reports, which the worker never answers.
const CELL_WIDTH_PX = 8
const CELL_HEIGHT_PX = 16

type Pointer = number
type Handle = number

interface LibghosttyVtExports {
  memory: WebAssembly.Memory
  ghostty_wasm_alloc: (len: number) => Pointer
  ghostty_wasm_free: (ptr: Pointer, len: number) => void
  ghostty_wasm_alloc_opaque: () => Pointer
  ghostty_wasm_free_opaque: (slot: Pointer) => void
  ghostty_wasm_take_opaque: (slot: Pointer) => Pointer
  ghostty_free: (allocator: Pointer, ptr: Pointer, len: number) => void
  ghostty_terminal_new: (allocator: Pointer, out: Pointer, cols: number, rows: number) => number
  ghostty_terminal_free: (terminal: Handle) => void
  ghostty_terminal_set: (terminal: Handle, option: number, value: Pointer) => number
  ghostty_terminal_get: (terminal: Handle, data: number, out: Pointer) => number
  ghostty_terminal_vt_write: (terminal: Handle, ptr: Pointer, len: number) => void
  ghostty_terminal_resize: (
    terminal: Handle,
    cols: number,
    rows: number,
    cellWidthPx: number,
    cellHeightPx: number,
  ) => number
  ghostty_formatter_terminal_new: (allocator: Pointer, out: Pointer, terminal: Handle) => number
  ghostty_formatter_set: (formatter: Handle, option: number, value: Pointer) => number
  ghostty_formatter_format_alloc: (
    formatter: Handle,
    allocator: Pointer,
    outPtr: Pointer,
    outLen: Pointer,
  ) => number
  ghostty_formatter_free: (formatter: Handle) => void
  ghostty_snapshot_encode_alloc: (
    terminal: Handle,
    allocator: Pointer,
    outPtr: Pointer,
    outLen: Pointer,
  ) => number
  ghostty_snapshot_decoder_new_buf: (
    allocator: Pointer,
    out: Pointer,
    ptr: Pointer,
    len: number,
  ) => number
  ghostty_snapshot_decoder_decode: (decoder: Handle, out: Pointer) => number
  ghostty_snapshot_decoder_free: (decoder: Handle) => void
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export class LibghosttyVt {
  private readonly x: LibghosttyVtExports

  public static fromFile(wasmPath: string): LibghosttyVt {
    const module = new WebAssembly.Module(readFileSync(wasmPath))
    const instance = new WebAssembly.Instance(module, {})
    return new LibghosttyVt(instance.exports as unknown as LibghosttyVtExports)
  }

  private constructor(exports: LibghosttyVtExports) {
    this.x = exports
  }

  public createTerminal(options: {
    cols: number
    rows: number
    scrollbackLines: number
    scrollbackBytes: number
    continuationBytes: number
  }): LibghosttyTerminal {
    const handle = this.takeOpaque(slot =>
      this.x.ghostty_terminal_new(0, slot, options.cols, options.rows),
    )
    const terminal = new LibghosttyTerminal(this, handle)
    this.setUsize(handle, OPT_SCROLLBACK_MAX_LINES, options.scrollbackLines)
    this.setUsize(handle, OPT_SCROLLBACK_MAX_BYTES, options.scrollbackBytes)
    this.setUsize(handle, OPT_CONTINUATION_MAX_BYTES, options.continuationBytes)
    // Mirrors xterm's convertEol: LF also returns to column 0. Set as the
    // reset default so the formatter does not emit it as a changed mode.
    this.setModeDefault(handle, MODE_LINEFEED, true)
    return terminal
  }

  /** @internal */
  public write(handle: Handle, data: string): void {
    const bytes = encoder.encode(data)
    this.withBytes(bytes, (ptr, len) => this.x.ghostty_terminal_vt_write(handle, ptr, len))
  }

  /** @internal */
  public resize(handle: Handle, cols: number, rows: number): void {
    this.check(
      this.x.ghostty_terminal_resize(handle, cols, rows, CELL_WIDTH_PX, CELL_HEIGHT_PX),
      'terminal_resize',
    )
  }

  /** @internal */
  public getU16(handle: Handle, data: number): number {
    return this.withScratch(2, ptr => {
      this.check(this.x.ghostty_terminal_get(handle, data, ptr), 'terminal_get')
      return this.view().getUint16(ptr, true)
    })
  }

  /** @internal */
  public cursor(handle: Handle): { x: number; y: number } {
    return { x: this.getU16(handle, DATA_CURSOR_X), y: this.getU16(handle, DATA_CURSOR_Y) }
  }

  /** @internal */
  public isAlternateScreen(handle: Handle): boolean {
    return this.withScratch(4, ptr => {
      this.check(this.x.ghostty_terminal_get(handle, DATA_ACTIVE_SCREEN, ptr), 'terminal_get')
      return this.view().getInt32(ptr, true) === 1
    })
  }

  /** @internal */
  public title(handle: Handle): string {
    return this.withScratch(8, ptr => {
      const result = this.x.ghostty_terminal_get(handle, DATA_TITLE, ptr)
      if (result === RESULT_NO_VALUE) {
        return ''
      }
      this.check(result, 'terminal_get title')
      const view = this.view()
      const strPtr = view.getUint32(ptr, true)
      const strLen = view.getUint32(ptr + 4, true)
      return strLen === 0 ? '' : decoder.decode(this.bytes().slice(strPtr, strPtr + strLen))
    })
  }

  /** @internal */
  public formatVt(handle: Handle, extras: number): string {
    const formatter = this.takeOpaque(slot =>
      this.x.ghostty_formatter_terminal_new(0, slot, handle),
    )
    try {
      this.withScratch(4, ptr => {
        this.view().setInt32(ptr, FORMATTER_FORMAT_VT, true)
        this.check(this.x.ghostty_formatter_set(formatter, FORMATTER_OPT_EMIT, ptr), 'emit')
        this.view().setUint32(ptr, extras, true)
        this.check(this.x.ghostty_formatter_set(formatter, FORMATTER_OPT_EXTRAS, ptr), 'extras')
        this.view().setUint8(ptr, 1)
        this.check(this.x.ghostty_formatter_set(formatter, FORMATTER_OPT_TRIM, ptr), 'trim')
      })
      const out = this.takeAllocated((outPtr, outLen) =>
        this.x.ghostty_formatter_format_alloc(formatter, 0, outPtr, outLen),
      )
      return decoder.decode(out)
    } finally {
      this.x.ghostty_formatter_free(formatter)
    }
  }

  /** @internal Copies a terminal, including unfinished VT input, via a snapshot. */
  public clone(handle: Handle): LibghosttyTerminal {
    const snapshot = this.takeAllocated((outPtr, outLen) =>
      this.x.ghostty_snapshot_encode_alloc(handle, 0, outPtr, outLen),
    )
    return this.withBytes(snapshot, (ptr, len) => {
      const snapshotDecoder = this.takeOpaque(slot =>
        this.x.ghostty_snapshot_decoder_new_buf(0, slot, ptr, len),
      )
      try {
        const copy = this.takeOpaque(slot =>
          this.x.ghostty_snapshot_decoder_decode(snapshotDecoder, slot),
        )
        return new LibghosttyTerminal(this, copy)
      } finally {
        this.x.ghostty_snapshot_decoder_free(snapshotDecoder)
      }
    })
  }

  /** @internal */
  public free(handle: Handle): void {
    this.x.ghostty_terminal_free(handle)
  }

  private setUsize(handle: Handle, option: number, value: number): void {
    this.withScratch(4, ptr => {
      this.view().setUint32(ptr, value, true)
      this.check(this.x.ghostty_terminal_set(handle, option, ptr), `terminal_set ${option}`)
    })
  }

  private setModeDefault(handle: Handle, mode: number, value: boolean): void {
    // GhosttyTerminalModeConfig: { uint16_t mode; bool value; }
    this.withScratch(4, ptr => {
      this.view().setUint16(ptr, mode, true)
      this.view().setUint8(ptr + 2, value ? 1 : 0)
      this.check(this.x.ghostty_terminal_set(handle, OPT_MODE_DEFAULT, ptr), 'mode default')
    })
  }

  private takeOpaque(call: (slot: Pointer) => number): Handle {
    const slot = this.x.ghostty_wasm_alloc_opaque()
    try {
      this.check(call(slot), 'opaque call')
      return this.x.ghostty_wasm_take_opaque(slot)
    } finally {
      this.x.ghostty_wasm_free_opaque(slot)
    }
  }

  private takeAllocated(call: (outPtr: Pointer, outLen: Pointer) => number): Uint8Array {
    const outPtr = this.x.ghostty_wasm_alloc_opaque()
    const outLen = this.x.ghostty_wasm_alloc(4)
    try {
      this.check(call(outPtr, outLen), 'alloc call')
      const ptr = this.x.ghostty_wasm_take_opaque(outPtr)
      const len = this.view().getUint32(outLen, true)
      const out = this.bytes().slice(ptr, ptr + len)
      this.x.ghostty_free(0, ptr, len)
      return out
    } finally {
      this.x.ghostty_wasm_free_opaque(outPtr)
      this.x.ghostty_wasm_free(outLen, 4)
    }
  }

  private withBytes<T>(bytes: Uint8Array, consume: (ptr: Pointer, len: number) => T): T {
    const size = Math.max(1, bytes.length)
    const ptr = this.x.ghostty_wasm_alloc(size)
    try {
      this.bytes().set(bytes, ptr)
      return consume(ptr, bytes.length)
    } finally {
      this.x.ghostty_wasm_free(ptr, size)
    }
  }

  private withScratch<T>(size: number, consume: (ptr: Pointer) => T): T {
    const ptr = this.x.ghostty_wasm_alloc(size)
    try {
      return consume(ptr)
    } finally {
      this.x.ghostty_wasm_free(ptr, size)
    }
  }

  private view(): DataView {
    return new DataView(this.x.memory.buffer)
  }

  private bytes(): Uint8Array {
    return new Uint8Array(this.x.memory.buffer)
  }

  private check(result: number, what: string): void {
    if (result !== RESULT_SUCCESS) {
      throw new Error(`libghostty-vt ${what} failed with result ${result}`)
    }
  }
}

export class LibghosttyTerminal {
  private freed = false

  public constructor(
    private readonly vt: LibghosttyVt,
    private readonly handle: Handle,
  ) {}

  public write(data: string): void {
    this.vt.write(this.handle, data)
  }

  public resize(cols: number, rows: number): void {
    this.vt.resize(this.handle, cols, rows)
  }

  public cursor(): { x: number; y: number } {
    return this.vt.cursor(this.handle)
  }

  public isAlternateScreen(): boolean {
    return this.vt.isAlternateScreen(this.handle)
  }

  public title(): string {
    return this.vt.title(this.handle)
  }

  public formatVt(extras: number = FORMATTER_EXTRAS_ALL): string {
    return this.vt.formatVt(this.handle, extras)
  }

  public clone(): LibghosttyTerminal {
    return this.vt.clone(this.handle)
  }

  public free(): void {
    if (this.freed) {
      return
    }
    this.freed = true
    this.vt.free(this.handle)
  }
}
