import type { IDisposable, Terminal } from '@xterm/xterm'
import { dispatchTerminalLinkIntent } from './linkHostEvent'

// Programs on a headless worker open links through the browser bridge script
// (src/platform/terminal/browserBridge.ts): BROWSER points at it, and it writes
// `ESC ] 7777 ; open ; <url> BEL` to the terminal. Codex does this when a link in its window is
// clicked. The URL then goes the way of a Ctrl+click on a link: TerminalLinkHost opens it, or
// shows the link card when the browser would block a new tab.

/** Must match TERMINAL_BROWSER_BRIDGE_OSC in src/platform/terminal/browserBridge.ts. */
export const TERMINAL_BROWSER_BRIDGE_OSC = 7777
/** An open must follow the person's own input in this terminal by at most this long. */
export const BROWSER_BRIDGE_USER_INTENT_WINDOW_MS = 5_000
const MAX_URL_LENGTH = 8_192

/** Returns the http(s) URL of an `open;<url>` payload, or null. */
export function parseBrowserBridgePayload(data: string): string | null {
  if (!data.startsWith('open;')) {
    return null
  }
  const uri = data.slice('open;'.length)
  // eslint-disable-next-line no-control-regex
  if (uri.length === 0 || uri.length > MAX_URL_LENGTH || /[\u0000-\u001f\u007f]/u.test(uri)) {
    return null
  }
  try {
    const url = new URL(uri)
    return url.protocol === 'http:' || url.protocol === 'https:' ? uri : null
  } catch {
    return null
  }
}

/**
 * Opens URLs a program hands to the bridge, but only shortly after the person pressed a key or
 * the mouse in this terminal: replayed output (restore, reattach) can carry old sequences, a
 * program must not open tabs on its own, and only the viewer who clicked should get the tab.
 */
export function installTerminalBrowserBridge({
  terminal,
  container,
  now = () => Date.now(),
}: {
  terminal: Terminal
  container: HTMLElement
  now?: () => number
}): () => void {
  if (typeof terminal.parser?.registerOscHandler !== 'function') {
    return () => undefined
  }
  let disposed = false
  let lastUserInputAt = Number.NEGATIVE_INFINITY
  let lastPointer: { x: number; y: number } | null = null
  const markUserInput = (event: Event): void => {
    lastUserInputAt = now()
    if (event instanceof MouseEvent) {
      lastPointer = { x: event.clientX, y: event.clientY }
    }
  }
  const userEvents = ['pointerdown', 'pointerup', 'keydown'] as const
  for (const type of userEvents) {
    container.addEventListener(type, markUserInput, true)
  }

  const handler: IDisposable = terminal.parser.registerOscHandler(
    TERMINAL_BROWSER_BRIDGE_OSC,
    data => {
      if (now() - lastUserInputAt > BROWSER_BRIDGE_USER_INTENT_WINDOW_MS) {
        return true
      }
      const uri = parseBrowserBridgePayload(data)
      if (!uri) {
        return true
      }
      const rect = container.getBoundingClientRect()
      const buffer = terminal.buffer.active
      dispatchTerminalLinkIntent(terminal.element ?? container, {
        action: 'open',
        target: { kind: 'url', uri },
        text: uri,
        clientX: lastPointer?.x ?? rect.left + rect.width / 2,
        clientY: lastPointer?.y ?? rect.top + rect.height / 2,
        bufferRow: buffer.baseY + buffer.cursorY + 1,
        requiresUserActivation: true,
        isCurrent: () => !disposed,
        focusTerminal: () => {
          if (!disposed) {
            terminal.focus()
          }
        },
      })
      return true
    },
  )

  return () => {
    disposed = true
    handler.dispose()
    for (const type of userEvents) {
      container.removeEventListener(type, markUserInput, true)
    }
  }
}
