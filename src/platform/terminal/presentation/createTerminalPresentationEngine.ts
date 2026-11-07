import {
  resolveTerminalPresentationEngineKind,
  type TerminalPresentationEngine,
  type TerminalPresentationEngineKind,
  type TerminalPresentationEngineOptions,
} from './TerminalPresentationEngine'
import { XtermPresentationEngine } from './XtermPresentationEngine'
import { LibghosttyPresentationEngine } from './libghostty/LibghosttyPresentationEngine'
import { LibghosttyVt } from './libghostty/LibghosttyVt'
import { LIBGHOSTTY_VT_WASM_PATH } from './libghostty/libghosttyVtWasmPath'

// One wasm instance serves every terminal in the process; compiled on first use.
let sharedLibghosttyVt: LibghosttyVt | null = null

function libghosttyVt(): LibghosttyVt {
  sharedLibghosttyVt ??= LibghosttyVt.fromFile(LIBGHOSTTY_VT_WASM_PATH)
  return sharedLibghosttyVt
}

export function createTerminalPresentationEngine(
  options: TerminalPresentationEngineOptions,
  kind: TerminalPresentationEngineKind = resolveTerminalPresentationEngineKind(),
): TerminalPresentationEngine {
  if (kind === 'libghostty') {
    return new LibghosttyPresentationEngine(libghosttyVt(), options)
  }
  return new XtermPresentationEngine(options)
}
