import {
  readTerminalPresentationEngineSetting,
  type TerminalPresentationEngine,
  type TerminalPresentationEngineKind,
  type TerminalPresentationEngineOptions,
  type TerminalPresentationEngineSetting,
} from './TerminalPresentationEngine'
import { XtermPresentationEngine } from './XtermPresentationEngine'
import { LibghosttyPresentationEngine } from './libghostty/LibghosttyPresentationEngine'
import { LibghosttyVt } from './libghostty/LibghosttyVt'
import { LIBGHOSTTY_VT_WASM_PATH } from './libghostty/libghosttyVtWasmPath'

export type CreateTerminalPresentationEngine = (
  options: TerminalPresentationEngineOptions,
  kind?: TerminalPresentationEngineKind,
) => TerminalPresentationEngine

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function describeSetting(setting: TerminalPresentationEngineSetting): string {
  return setting.raw === undefined ? 'default' : `${setting.env}=${JSON.stringify(setting.raw)}`
}

// libghostty is optional: if its wasm cannot be loaded, or one terminal cannot
// be created in it, the session falls back to xterm instead of failing to open.
// The first engine created reports which engine the process runs, so a typo in
// the setting or a broken wasm shows up in the worker's log.
export function createTerminalPresentationEngineFactory(dependencies: {
  loadLibghosttyVt: () => LibghosttyVt
  readSetting?: () => TerminalPresentationEngineSetting
  report: (message: string) => void
}): CreateTerminalPresentationEngine {
  const readSetting = dependencies.readSetting ?? (() => readTerminalPresentationEngineSetting())
  let vt: LibghosttyVt | null = null
  let vtUnavailable = false
  let reportedSelection = false

  const reportSelectionOnce = (
    setting: TerminalPresentationEngineSetting | null,
    requested: TerminalPresentationEngineKind,
    actual: TerminalPresentationEngineKind,
  ): void => {
    if (reportedSelection) {
      return
    }
    reportedSelection = true
    if (setting?.unrecognized) {
      dependencies.report(
        `terminal engine: ignoring unknown ${describeSetting(setting)}; expected "xterm" or "libghostty"`,
      )
    }
    const fallback = actual === requested ? '' : ` (requested ${requested})`
    const source = setting ? describeSetting(setting) : 'the caller'
    dependencies.report(`terminal engine: ${actual}${fallback}, from ${source}`)
  }

  const createLibghostty = (
    options: TerminalPresentationEngineOptions,
  ): TerminalPresentationEngine | null => {
    if (vtUnavailable) {
      return null
    }
    try {
      vt ??= dependencies.loadLibghosttyVt()
    } catch (error) {
      vtUnavailable = true
      dependencies.report(
        `terminal engine: libghostty-vt failed to load, using xterm for every terminal: ${errorMessage(error)}`,
      )
      return null
    }
    try {
      return new LibghosttyPresentationEngine(vt, options)
    } catch (error) {
      dependencies.report(
        `terminal engine: libghostty terminal could not be created, using xterm for this one: ${errorMessage(error)}`,
      )
      return null
    }
  }

  return (options, kind) => {
    const setting = kind ? null : readSetting()
    const requested = kind ?? setting?.kind ?? 'xterm'
    const engine =
      (requested === 'libghostty' ? createLibghostty(options) : null) ??
      new XtermPresentationEngine(options)
    reportSelectionOnce(setting, requested, engine.kind)
    return engine
  }
}

// One wasm instance serves every terminal in the process; compiled on first use.
export const createTerminalPresentationEngine: CreateTerminalPresentationEngine =
  createTerminalPresentationEngineFactory({
    loadLibghosttyVt: () => LibghosttyVt.fromFile(LIBGHOSTTY_VT_WASM_PATH),
    report: message => process.stderr.write(`[opencove] ${message}\n`),
  })
