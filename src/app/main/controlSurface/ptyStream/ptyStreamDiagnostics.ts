import { appendFileSync } from 'node:fs'

export function logPtyStreamResizeDiagnostics(payload: Record<string, unknown>): void {
  logTilingSpike({ ...payload, diagEvent: payload['event'], event: 'resize_diag' })
  if (process.env.OPENCOVE_TERMINAL_DIAGNOSTICS !== '1') {
    return
  }

  process.stderr.write(
    `[opencove-pty-resize] ${JSON.stringify({ ts: new Date().toISOString(), ...payload })}\n`,
  )
}

/** SPIKE (tiling remount, never merged): append one JSON line per PTY stream event. */
export function logTilingSpike(payload: Record<string, unknown>): void {
  const path = process.env.OPENCOVE_SPIKE_LOG
  if (!path) {
    return
  }
  try {
    appendFileSync(path, `${JSON.stringify({ ts: Date.now(), ...payload })}\n`)
  } catch {
    // diagnostics only
  }
}
