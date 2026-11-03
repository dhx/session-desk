import { describe, expect, it, vi } from 'vitest'
import type { Terminal } from '@xterm/xterm'
import {
  decodeOsc52Payload,
  installTerminalOsc52Clipboard,
  OSC52_USER_INTENT_WINDOW_MS,
} from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/terminalOsc52Clipboard'

const encode = (text: string): string =>
  btoa(String.fromCharCode(...new TextEncoder().encode(text)))

function createFakeTerminal() {
  let handler: ((data: string) => boolean | Promise<boolean>) | null = null
  const dispose = vi.fn()
  const terminal = {
    parser: {
      registerOscHandler: (ident: number, callback: (data: string) => boolean) => {
        expect(ident).toBe(52)
        handler = callback
        return { dispose }
      },
    },
  } as unknown as Terminal
  return { terminal, emit: (data: string) => handler?.(data), dispose }
}

describe('OSC 52 payload decoding', () => {
  it('decodes UTF-8 text for any selection target', () => {
    expect(decodeOsc52Payload(`c;${encode('hello wörld ✓')}`)).toBe('hello wörld ✓')
    expect(decodeOsc52Payload(`;${encode('x')}`)).toBe('x')
    expect(decodeOsc52Payload(`pc;${encode('multi\nline')}`)).toBe('multi\nline')
  })

  it('ignores queries, clears and malformed data', () => {
    expect(decodeOsc52Payload('c;?')).toBeNull()
    expect(decodeOsc52Payload('c;')).toBeNull()
    expect(decodeOsc52Payload('c;not base64!')).toBeNull()
    expect(decodeOsc52Payload('nosep')).toBeNull()
  })
})

describe('terminal OSC 52 clipboard', () => {
  it('copies right after the person used the terminal, not on replayed or unprompted output', () => {
    const { terminal, emit, dispose } = createFakeTerminal()
    const container = document.createElement('div')
    const writeClipboard = vi.fn()
    let time = 1_000_000
    const uninstall = installTerminalOsc52Clipboard({
      terminal,
      container,
      writeClipboard,
      now: () => time,
    })

    expect(emit(`c;${encode('restored')}`)).toBe(true)
    container.dispatchEvent(new Event('pointerup'))
    time += 200
    expect(emit(`c;${encode('selected')}`)).toBe(true)
    time += OSC52_USER_INTENT_WINDOW_MS + 1
    emit(`c;${encode('late')}`)

    return Promise.resolve().then(() => {
      expect(writeClipboard).toHaveBeenCalledTimes(1)
      expect(writeClipboard).toHaveBeenCalledWith('selected')
      uninstall()
      expect(dispose).toHaveBeenCalled()
    })
  })
})
