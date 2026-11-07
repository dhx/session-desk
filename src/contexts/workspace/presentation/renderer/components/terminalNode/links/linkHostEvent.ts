import type { TerminalLinkTarget } from '../linkProviders/terminal-link-snapshot'

export const TERMINAL_LINK_INVALIDATION_EVENT = 'opencove:terminal-links-invalidated'

export const TERMINAL_LINK_EVENT = 'opencove:terminal-link'

export interface TerminalLinkIntent {
  action: 'hover' | 'leave' | 'menu' | 'open'
  target: TerminalLinkTarget
  text: string
  clientX: number
  clientY: number
  bufferRow: number
  observedCwd?: string
  preferSystem?: boolean
  /** Opened by a program, not a click on the link: open only while the browser allows a tab. */
  requiresUserActivation?: boolean
  isCurrent: () => boolean
  focusTerminal: () => void
}

export function dispatchTerminalLinkIntent(
  element: HTMLElement | undefined,
  intent: TerminalLinkIntent,
): void {
  element?.dispatchEvent(
    new CustomEvent<TerminalLinkIntent>(TERMINAL_LINK_EVENT, {
      detail: intent,
      bubbles: true,
    }),
  )
}

/** Whether the page may open a tab now. Browsers without the API count as allowed. */
export function hasTransientUserActivation(): boolean {
  const activation = (navigator as Navigator & { userActivation?: { isActive: boolean } })
    .userActivation
  return activation ? activation.isActive : true
}
