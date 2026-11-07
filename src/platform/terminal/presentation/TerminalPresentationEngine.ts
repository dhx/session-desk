// The terminal emulator a presentation session keeps its authoritative screen in.
// The session owns sequencing, revisions and geometry; the engine owns only
// the emulated screen and how it is serialized for hydration.
export type TerminalPresentationBufferKind = 'normal' | 'alternate' | 'unknown'

export interface TerminalPresentationEngine {
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

export function resolveTerminalPresentationEngineKind(
  value: string | undefined = process.env[TERMINAL_PRESENTATION_ENGINE_ENV],
): TerminalPresentationEngineKind {
  return value?.trim().toLowerCase() === 'libghostty' ? 'libghostty' : 'xterm'
}
