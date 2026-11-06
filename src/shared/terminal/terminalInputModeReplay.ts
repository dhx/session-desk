// A bounded replay checkpoint derived from PTY output, not a second mode
// authority. Xterm owns the active modes; this only repairs input semantics
// when hydration discards display bytes or injects a full terminal reset.
export const INPUT_SEMANTIC_DEC_PRIVATE_MODES = new Set([
  9, 1000, 1002, 1003, 1004, 1005, 1006, 1015, 1016, 2004,
])
const MODES = INPUT_SEMANTIC_DEC_PRIVATE_MODES

type State = 'text' | 'escape' | 'csi' | 'osc' | 'string'

export function createTerminalInputModeReplay(): {
  record: (data: string) => string
  recordSnapshot: (data: string) => void
  acceptSnapshot: (
    data: string,
    appliedSeq: number | null,
    chunks: ReadonlyArray<{ seq: number | null; inputModeControls: string }>,
  ) => void
  snapshot: () => string
} {
  const controls = new Map<number, string>()
  let state: State = 'text'
  let parameters = ''
  let operations: string[] | null = null

  const remember = (mode: number, final: string): void => {
    // Last-operation order matters: tracking and encoding modes are mutually
    // exclusive in xterm, and disabling any one can select their default.
    controls.delete(mode)
    const control = `\u001b[?${mode}${final}`
    controls.set(mode, control)
    operations?.push(control)
  }

  const reset = (): void => {
    controls.clear()
    for (const mode of MODES) {
      remember(mode, 'l')
    }
  }

  const recordSnapshot = (data: string): void => {
    // Parse snapshot scaffolding independently; do not disturb a partial
    // live-stream sequence carried across the accepted snapshot boundary.
    const snapshot = createTerminalInputModeReplay()
    snapshot.record(data)
    for (const control of snapshot.snapshot().split('\u001b[?').slice(1)) {
      remember(Number(control.slice(0, -1)), control.slice(-1))
    }
  }

  return {
    snapshot: () => [...controls.values()].join(''),
    recordSnapshot,
    acceptSnapshot: (data, appliedSeq, chunks) => {
      if (appliedSeq === null) {
        return
      }
      recordSnapshot(data)
      for (const chunk of chunks) {
        if (chunk.seq !== null && chunk.seq > appliedSeq) {
          recordSnapshot(chunk.inputModeControls)
        }
      }
    },
    record: data => {
      operations = []
      for (const character of data) {
        const code = character.charCodeAt(0)
        if (code === 0x18 || code === 0x1a) {
          state = 'text'
          continue
        }
        // Xterm's parser ends control strings on ESC and starts a new
        // escape sequence. C1 introducers are transitions in every state.
        if (character === '\u001b') {
          state = 'escape'
          continue
        }
        if (code === 0x9b) {
          parameters = ''
          state = 'csi'
          continue
        }
        if (code === 0x9d) {
          state = 'osc'
          continue
        }
        if ([0x90, 0x98, 0x9e, 0x9f].includes(code)) {
          state = 'string'
          continue
        }
        if (code === 0x9c || (state === 'osc' && code === 7)) {
          state = 'text'
          continue
        }
        if (state === 'osc' || state === 'string' || code < 0x20 || code === 0x7f) {
          continue
        }
        if (state === 'escape') {
          state = 'text'
          if (character === '[') {
            parameters = ''
            state = 'csi'
          } else if (character === ']') {
            state = 'osc'
          } else if (['P', '_', '^', 'X'].includes(character)) {
            state = 'string'
          } else if (character === 'c') {
            reset()
          }
          continue
        }
        if (state !== 'csi') {
          continue
        }
        if (code >= 0x40 && code <= 0x7e) {
          if ((character === 'h' || character === 'l') && /^\?\d+(;\d+)*$/.test(parameters)) {
            for (const value of parameters.slice(1).split(';')) {
              const mode = Number(value)
              if (MODES.has(mode)) {
                remember(mode, character)
              }
            }
          } else if (character === 'p' && parameters === '!') {
            // DECSTR resets core focus/paste modes, but not CoreMouseService.
            remember(1004, 'l')
            remember(2004, 'l')
          }
          state = 'text'
        } else if (code >= 0x20) {
          // Bound malformed/incomplete CSI without retaining arbitrary output.
          parameters = parameters.length < 256 ? parameters + character : 'invalid'
        }
      }
      const result = operations.join('')
      operations = null
      return result
    },
  }
}
