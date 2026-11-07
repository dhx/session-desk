// The terminal emulator a presentation session keeps its authoritative screen in.
// The session owns sequencing, revisions and geometry; the engine owns only
// the emulated screen and how it is serialized for hydration.
export type TerminalPresentationBufferKind = 'normal' | 'alternate' | 'unknown'

export interface TerminalPresentationEngine {
  readonly kind: TerminalPresentationEngineKind
  readonly cols: number
  readonly rows: number
  // Resolves once the data has been parsed into the screen.
  write: (data: string) => Promise<void>
  resize: (cols: number, rows: number) => void
  bufferKind: () => TerminalPresentationBufferKind
  cursor: () => { x: number; y: number }
  // VT bytes that recreate the screen, scrollback and modes in a fresh xterm.
  serialize: () => string
  onTitleChange: (listener: (title: string) => void) => void
  dispose: () => void
}

export type TerminalPresentationEngineOptions = {
  cols: number
  rows: number
  scrollback: number
}

export type TerminalPresentationEngineKind = 'xterm' | 'libghostty'

export const TERMINAL_PRESENTATION_ENGINE_ENV = 'SESSION_DESK_TERMINAL_ENGINE'

export type TerminalPresentationEngineSetting = {
  env: typeof TERMINAL_PRESENTATION_ENGINE_ENV
  // The value as set, or undefined when the variable is unset or empty.
  raw: string | undefined
  kind: TerminalPresentationEngineKind
  // Set but neither engine's name; the kind then falls back to xterm.
  unrecognized: boolean
}

export function readTerminalPresentationEngineSetting(
  value: string | undefined = process.env[TERMINAL_PRESENTATION_ENGINE_ENV],
): TerminalPresentationEngineSetting {
  const normalized = value?.trim().toLowerCase() ?? ''
  const raw = normalized.length > 0 ? value : undefined
  const kind: TerminalPresentationEngineKind = normalized === 'libghostty' ? 'libghostty' : 'xterm'
  return {
    env: TERMINAL_PRESENTATION_ENGINE_ENV,
    raw,
    kind,
    unrecognized: raw !== undefined && normalized !== 'libghostty' && normalized !== 'xterm',
  }
}
