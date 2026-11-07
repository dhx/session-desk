import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'

// Programs in a terminal open links by starting a browser on the machine they run on: Codex
// when a link is clicked, `gh … --web`, Python's webbrowser, xdg-open. On a headless worker
// (the Session Desk container) there is none, and the person's browser is the one showing the
// terminal. The bridge points BROWSER (and, as a fallback on PATH, xdg-open) at a small script
// that hands the URL back through the terminal as `ESC ] 7777 ; open ; <url> BEL`; the renderer
// (installTerminalBrowserBridge) opens it in the viewer's browser.

/** Private OSC identifier the renderer listens on. */
export const TERMINAL_BROWSER_BRIDGE_OSC = 7777

export const BROWSER_BRIDGE_SCRIPT_NAME = 'session-desk-open'

/** Set in every bridged terminal; the script only hands URLs to terminals of such processes. */
export const BROWSER_BRIDGE_MARKER_ENV = 'SESSION_DESK_BROWSER_BRIDGE'

export const BROWSER_BRIDGE_SCRIPT = `#!/bin/sh
# Session Desk: opens a URL in the browser of the person viewing this terminal.
# Written by Session Desk; BROWSER and xdg-open point here in headless terminals.
url=$1
case $url in
  http://*|https://*) ;;
  *) echo "${BROWSER_BRIDGE_SCRIPT_NAME}: only http(s) URLs can be opened in the viewer's browser" >&2; exit 1 ;;
esac
if printf '%s' "$url" | LC_ALL=C grep -q '[[:cntrl:]]'; then
  echo "${BROWSER_BRIDGE_SCRIPT_NAME}: refusing a URL with control characters" >&2
  exit 1
fi
if [ -n "$TMUX" ]; then
  seq=$(printf '\\033Ptmux;\\033\\033]${TERMINAL_BROWSER_BRIDGE_OSC};open;%s\\007\\033\\\\' "$url")
else
  seq=$(printf '\\033]${TERMINAL_BROWSER_BRIDGE_OSC};open;%s\\007' "$url")
fi
# Programs often start the browser with stdio detached, so write to the controlling terminal,
# or else to the first terminal an ancestor process has open. The walk stays among processes
# started in a Session Desk terminal (they carry ${BROWSER_BRIDGE_MARKER_ENV}), so it never
# reaches a terminal the worker itself was started from.
if (printf '%s' "$seq" > /dev/tty) 2>/dev/null; then
  exit 0
fi
pid=$PPID
while [ -n "$pid" ] && [ "$pid" -gt 1 ] 2>/dev/null; do
  tr '\\0' '\\n' < "/proc/$pid/environ" 2>/dev/null | grep -qx '${BROWSER_BRIDGE_MARKER_ENV}=1' || break
  for fd in 0 1 2; do
    tty=$(readlink "/proc/$pid/fd/$fd" 2>/dev/null)
    case $tty in
      /dev/pts/*) printf '%s' "$seq" > "$tty" 2>/dev/null && exit 0 ;;
    esac
  done
  pid=$(sed -n 's/^PPid:[[:space:]]*//p' "/proc/$pid/status" 2>/dev/null)
done
echo "${BROWSER_BRIDGE_SCRIPT_NAME}: no terminal to hand the URL to: $url" >&2
exit 1
`

function hasValue(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * Only a Linux terminal without a display and without a BROWSER of its own gets the bridge:
 * desktops keep their own browser, and an explicit BROWSER is the person's choice.
 */
export function needsBrowserBridge(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): boolean {
  return (
    platform === 'linux' &&
    !hasValue(env.BROWSER) &&
    !hasValue(env.DISPLAY) &&
    !hasValue(env.WAYLAND_DISPLAY)
  )
}

/** BROWSER names the script; its folder goes last on PATH so a real xdg-open still wins. */
export function withBrowserBridgeEnv(env: NodeJS.ProcessEnv, binDir: string): NodeJS.ProcessEnv {
  const script = path.join(binDir, BROWSER_BRIDGE_SCRIPT_NAME)
  const entries = (env.PATH ?? '').split(':').filter(entry => entry.length > 0)
  return {
    ...env,
    BROWSER: script,
    [BROWSER_BRIDGE_MARKER_ENV]: '1',
    PATH: entries.includes(binDir) ? env.PATH : [...entries, binDir].join(':'),
  }
}

function writeIfChanged(file: string, content: string): void {
  try {
    if (readFileSync(file, 'utf8') === content) {
      chmodSync(file, 0o755)
      return
    }
  } catch {
    // Missing: write it below.
  }
  const temp = `${file}.${process.pid}.tmp`
  writeFileSync(temp, content, { mode: 0o755 })
  renameSync(temp, file)
}

function linkXdgOpen(binDir: string): void {
  const link = path.join(binDir, 'xdg-open')
  try {
    if (lstatSync(link).isSymbolicLink() && readlinkSync(link) === BROWSER_BRIDGE_SCRIPT_NAME) {
      return
    }
    unlinkSync(link)
  } catch {
    // Missing: create it below.
  }
  symlinkSync(BROWSER_BRIDGE_SCRIPT_NAME, link)
}

/**
 * Writes the bridge script into `<cache>/session-desk/bin` (the person's own cache folder, never
 * a shared temp dir) and returns that folder, or null when it cannot be written.
 */
export function installBrowserBridge(env: NodeJS.ProcessEnv, homeDir: string): string | null {
  const cacheRoot = hasValue(env.XDG_CACHE_HOME)
    ? (env.XDG_CACHE_HOME as string)
    : path.join(homeDir, '.cache')
  if (!path.isAbsolute(cacheRoot)) {
    return null
  }
  const binDir = path.join(cacheRoot, 'session-desk', 'bin')
  try {
    mkdirSync(binDir, { recursive: true, mode: 0o700 })
    writeIfChanged(path.join(binDir, BROWSER_BRIDGE_SCRIPT_NAME), BROWSER_BRIDGE_SCRIPT)
    linkXdgOpen(binDir)
    return binDir
  } catch {
    return null
  }
}
