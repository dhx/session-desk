import type { IDisposable, Terminal } from '@xterm/xterm'
import { copyTextToClipboard } from './inputBridge'

// TUIs that capture the mouse (Claude Code fullscreen, Codex) select text themselves and hand
// the copy to the terminal as OSC 52 (`ESC ] 52 ; <targets> ; <base64> BEL`). xterm.js ignores
// OSC 52 unless someone handles it, so their copies never reached the clipboard.

/** A copy must follow the person's own input in this terminal by at most this long. */
export const OSC52_USER_INTENT_WINDOW_MS = 5_000
/** Larger payloads are dropped (base64 characters, ~750 KB of text). */
export const OSC52_MAX_PAYLOAD_LENGTH = 1_000_000

/**
 * Decodes an OSC 52 payload (without the `52;` identifier) into the text to copy.
 * Returns null for queries (`?`), clears (empty data) and malformed payloads: the terminal never
 * reports the clipboard back to the program, and an empty write would wipe what the person copied.
 */
export function decodeOsc52Payload(data: string): string | null {
  const separator = data.indexOf(';')
  if (separator === -1) {
    return null
  }
  const encoded = data.slice(separator + 1).replace(/\s+/gu, '')
  if (encoded.length === 0 || encoded === '?' || encoded.length > OSC52_MAX_PAYLOAD_LENGTH) {
    return null
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/u.test(encoded)) {
    return null
  }
  try {
    const binary = atob(encoded)
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0))
    const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
    return text.length > 0 ? text : null
  } catch {
    return null
  }
}

/**
 * Lets programs in the terminal write the system clipboard through OSC 52.
 *
 * Only shortly after the person pressed a key or the mouse in this terminal: output replayed
 * when a window is restored or reattached can carry old OSC 52 sequences, and a program should
 * not overwrite the clipboard on its own. Browsers want a recent user gesture for clipboard
 * writes as well, so the window matches what the Clipboard API allows anyway.
 */
export function installTerminalOsc52Clipboard({
  terminal,
  container,
  writeClipboard = copyTextToClipboard,
  now = () => Date.now(),
}: {
  terminal: Terminal
  container: HTMLElement
  writeClipboard?: (text: string) => Promise<void> | void
  now?: () => number
}): () => void {
  if (typeof terminal.parser?.registerOscHandler !== 'function') {
    return () => undefined
  }
  let lastUserInputAt = Number.NEGATIVE_INFINITY
  const markUserInput = (): void => {
    lastUserInputAt = now()
  }
  const userEvents = ['pointerdown', 'pointerup', 'keydown'] as const
  for (const type of userEvents) {
    container.addEventListener(type, markUserInput, true)
  }

  const handler: IDisposable = terminal.parser.registerOscHandler(52, data => {
    if (now() - lastUserInputAt > OSC52_USER_INTENT_WINDOW_MS) {
      return true
    }
    const text = decodeOsc52Payload(data)
    if (text !== null) {
      void Promise.resolve()
        .then(() => writeClipboard(text))
        .catch(() => undefined)
    }
    return true
  })

  return () => {
    handler.dispose()
    for (const type of userEvents) {
      container.removeEventListener(type, markUserInput, true)
    }
  }
}
