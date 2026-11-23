import { useSyncExternalStore } from 'react'

/**
 * Which drawing of the app's icons is shown: the pixel art (Cove's own look) or line icons. The
 * active theme chooses (`icons` in a theme declaration); the icon components read it here, so
 * every icon follows a theme change without the places that use one knowing about it.
 */
export const ICON_SETS = ['pixel', 'line'] as const
export type IconSet = (typeof ICON_SETS)[number]
export const DEFAULT_ICON_SET: IconSet = 'pixel'

let current: IconSet = DEFAULT_ICON_SET
const listeners = new Set<() => void>()

export function isIconSet(value: unknown): value is IconSet {
  return typeof value === 'string' && (ICON_SETS as readonly string[]).includes(value)
}

export function readIconSet(): IconSet {
  return current
}

/** Called by the theme lifecycle only; returns the set that was active before. */
export function applyIconSet(next: IconSet): IconSet {
  const previous = current
  if (next !== previous) {
    current = next
    listeners.forEach(listener => listener())
  }
  return previous
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useIconSet(): IconSet {
  return useSyncExternalStore(subscribe, readIconSet, () => DEFAULT_ICON_SET)
}
