import { describe, expect, it, vi } from 'vitest'
import type { Terminal } from '@xterm/xterm'
import {
  BROWSER_BRIDGE_USER_INTENT_WINDOW_MS,
  installTerminalBrowserBridge,
  parseBrowserBridgePayload,
  TERMINAL_BROWSER_BRIDGE_OSC,
} from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/links/installTerminalBrowserBridge'
import {
  TERMINAL_LINK_EVENT,
  type TerminalLinkIntent,
} from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/links/linkHostEvent'
import { TERMINAL_BROWSER_BRIDGE_OSC as SERVER_OSC } from '../../../src/platform/terminal/browserBridge'

function createFakeTerminal(element: HTMLElement) {
  let handler: ((data: string) => boolean | Promise<boolean>) | null = null
  const dispose = vi.fn()
  const terminal = {
    element,
    buffer: { active: { baseY: 10, cursorY: 3 } },
    focus: vi.fn(),
    parser: {
      registerOscHandler: (ident: number, callback: (data: string) => boolean) => {
        expect(ident).toBe(TERMINAL_BROWSER_BRIDGE_OSC)
        handler = callback
        return { dispose }
      },
    },
  } as unknown as Terminal
  return { terminal, emit: (data: string) => handler?.(data), dispose }
}

describe('browser bridge payload', () => {
  it('uses the identifier the bridge script writes', () => {
    expect(TERMINAL_BROWSER_BRIDGE_OSC).toBe(SERVER_OSC)
  })

  it('accepts http(s) URLs only', () => {
    expect(parseBrowserBridgePayload('open;https://github.com/dhx/session-board/pull/261')).toBe(
      'https://github.com/dhx/session-board/pull/261',
    )
    expect(parseBrowserBridgePayload('open;http://localhost:3000/a?b=c;d')).toBe(
      'http://localhost:3000/a?b=c;d',
    )
    expect(parseBrowserBridgePayload('open;file:///etc/passwd')).toBeNull()
    expect(parseBrowserBridgePayload('open;javascript:alert(1)')).toBeNull()
    expect(parseBrowserBridgePayload('open;https://x.test/\u0007')).toBeNull()
    expect(parseBrowserBridgePayload('open;')).toBeNull()
    expect(parseBrowserBridgePayload('close;https://x.test')).toBeNull()
  })
})

describe('terminal browser bridge', () => {
  it('opens right after the person used the terminal, not on replayed or unprompted output', () => {
    const container = document.createElement('div')
    const element = document.createElement('div')
    container.appendChild(element)
    const { terminal, emit, dispose } = createFakeTerminal(element)
    const intents: TerminalLinkIntent[] = []
    container.addEventListener(TERMINAL_LINK_EVENT, event => {
      intents.push((event as CustomEvent<TerminalLinkIntent>).detail)
    })
    let time = 1_000_000
    const uninstall = installTerminalBrowserBridge({ terminal, container, now: () => time })

    expect(emit('open;https://replayed.test/')).toBe(true)
    element.dispatchEvent(
      new MouseEvent('pointerdown', { bubbles: true, clientX: 40, clientY: 50 }),
    )
    time += 300
    expect(emit('open;https://clicked.test/')).toBe(true)
    time += BROWSER_BRIDGE_USER_INTENT_WINDOW_MS + 1
    emit('open;https://late.test/')

    expect(intents).toHaveLength(1)
    expect(intents[0]).toMatchObject({
      action: 'open',
      target: { kind: 'url', uri: 'https://clicked.test/' },
      clientX: 40,
      clientY: 50,
      bufferRow: 14,
      requiresUserActivation: true,
    })
    expect(intents[0].isCurrent()).toBe(true)
    uninstall()
    expect(intents[0].isCurrent()).toBe(false)
    expect(dispose).toHaveBeenCalled()
  })
})
