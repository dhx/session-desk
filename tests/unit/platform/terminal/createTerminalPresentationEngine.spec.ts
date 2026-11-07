import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  readTerminalPresentationEngineSetting,
  type TerminalPresentationEngineSetting,
} from '../../../../src/platform/terminal/presentation/TerminalPresentationEngine'
import { createTerminalPresentationEngineFactory } from '../../../../src/platform/terminal/presentation/createTerminalPresentationEngine'
import { LibghosttyVt } from '../../../../src/platform/terminal/presentation/libghostty/LibghosttyVt'
import { LIBGHOSTTY_VT_WASM_PATH } from '../../../../src/platform/terminal/presentation/libghostty/libghosttyVtWasmPath'

const OPTIONS = { cols: 20, rows: 4, scrollback: 10 }

// The machine running the tests may set the variable itself.
beforeEach(() => {
  vi.stubEnv('SESSION_DESK_TERMINAL_ENGINE', undefined)
})
afterEach(() => {
  vi.unstubAllEnvs()
})

function factory(options: { value?: string; loadLibghosttyVt?: () => LibghosttyVt }) {
  const reports: string[] = []
  const loadLibghosttyVt = vi.fn(
    options.loadLibghosttyVt ?? (() => LibghosttyVt.fromFile(LIBGHOSTTY_VT_WASM_PATH)),
  )
  const create = createTerminalPresentationEngineFactory({
    loadLibghosttyVt,
    readSetting: (): TerminalPresentationEngineSetting =>
      readTerminalPresentationEngineSetting(options.value),
    report: message => reports.push(message),
  })
  return { create, reports, loadLibghosttyVt }
}

describe('readTerminalPresentationEngineSetting', () => {
  it.each([
    [undefined, 'xterm', undefined, false],
    ['', 'xterm', undefined, false],
    ['  ', 'xterm', undefined, false],
    ['xterm', 'xterm', 'xterm', false],
    ['libghostty', 'libghostty', 'libghostty', false],
    [' LibGhostty ', 'libghostty', ' LibGhostty ', false],
    ['ghostty', 'xterm', 'ghostty', true],
  ])('reads %j as %s', (value, kind, raw, unrecognized) => {
    expect(readTerminalPresentationEngineSetting(value)).toEqual({
      env: 'SESSION_DESK_TERMINAL_ENGINE',
      raw,
      kind,
      unrecognized,
    })
  })
})

describe('createTerminalPresentationEngineFactory', () => {
  it('reports the engine once, with where the choice came from', () => {
    const { create, reports } = factory({ value: 'libghostty' })
    const first = create(OPTIONS)
    const second = create(OPTIONS)

    expect([first.kind, second.kind]).toEqual(['libghostty', 'libghostty'])
    expect(reports).toEqual([
      'terminal engine: libghostty, from SESSION_DESK_TERMINAL_ENGINE="libghostty"',
    ])
    first.dispose()
    second.dispose()
  })

  it('says xterm runs by default when nothing is set', () => {
    const { create, reports, loadLibghosttyVt } = factory({})
    const engine = create(OPTIONS)

    expect(engine.kind).toBe('xterm')
    expect(reports).toEqual(['terminal engine: xterm, from default'])
    expect(loadLibghosttyVt).not.toHaveBeenCalled()
    engine.dispose()
  })

  it('warns about an unknown value and runs xterm', () => {
    const { create, reports } = factory({ value: 'ghostty' })
    const engine = create(OPTIONS)

    expect(engine.kind).toBe('xterm')
    expect(reports).toEqual([
      'terminal engine: ignoring unknown SESSION_DESK_TERMINAL_ENGINE="ghostty"; expected "xterm" or "libghostty"',
      'terminal engine: xterm, from SESSION_DESK_TERMINAL_ENGINE="ghostty"',
    ])
    engine.dispose()
  })

  it('names an explicitly requested engine as coming from the caller', () => {
    const { create, reports } = factory({ value: 'ghostty' })
    const engine = create(OPTIONS, 'libghostty')

    expect(engine.kind).toBe('libghostty')
    expect(reports).toEqual(['terminal engine: libghostty, from the caller'])
    engine.dispose()
  })

  it('falls back to xterm for good when the wasm cannot be loaded', async () => {
    const { create, reports, loadLibghosttyVt } = factory({
      value: 'libghostty',
      loadLibghosttyVt: () => {
        throw new Error('ENOENT: ghostty-vt.wasm')
      },
    })
    const first = create(OPTIONS)
    const second = create(OPTIONS)

    expect([first.kind, second.kind]).toEqual(['xterm', 'xterm'])
    expect(loadLibghosttyVt).toHaveBeenCalledTimes(1)
    expect(reports).toEqual([
      'terminal engine: libghostty-vt failed to load, using xterm for every terminal: ENOENT: ghostty-vt.wasm',
      'terminal engine: xterm (requested libghostty), from SESSION_DESK_TERMINAL_ENGINE="libghostty"',
    ])
    await first.write('still works')
    expect(first.serialize()).toContain('still works')
    first.dispose()
    second.dispose()
  })

  it('falls back to xterm for one terminal libghostty cannot create', () => {
    const real = LibghosttyVt.fromFile(LIBGHOSTTY_VT_WASM_PATH)
    let failNext = true
    const flaky = new Proxy(real, {
      get(target, property, receiver) {
        if (property === 'createTerminal' && failNext) {
          failNext = false
          return () => {
            throw new Error('libghostty-vt opaque call failed with result -1')
          }
        }
        const value = Reflect.get(target, property, receiver)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    const { create, reports } = factory({ value: 'libghostty', loadLibghosttyVt: () => flaky })
    const first = create(OPTIONS)
    const second = create(OPTIONS)

    expect([first.kind, second.kind]).toEqual(['xterm', 'libghostty'])
    expect(reports).toEqual([
      'terminal engine: libghostty terminal could not be created, using xterm for this one: libghostty-vt opaque call failed with result -1',
      'terminal engine: xterm (requested libghostty), from SESSION_DESK_TERMINAL_ENGINE="libghostty"',
    ])
    first.dispose()
    second.dispose()
  })
})
