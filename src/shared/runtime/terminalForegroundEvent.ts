import type { TerminalForegroundEvent } from '../contracts/dto'
import { isForegroundRecognizedProvider } from '../contracts/agentProviderDescriptors'

function normalizeOptionalFiniteInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : null
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/** Validates a `foreground` message of the worker's pty stream (desktop and Web UI clients alike). */
export function parseTerminalForegroundEvent(
  record: Record<string, unknown>,
): TerminalForegroundEvent | null {
  const sessionId = normalizeOptionalString(record.sessionId)
  const observedAtMs = normalizeOptionalFiniteInt(record.observedAtMs)
  const source =
    record.source === 'process_scan' ||
    record.source === 'windows_exit_code' ||
    record.source === 'windows_prompt_timeout'
      ? record.source
      : null
  const availability =
    record.availability === 'available' || record.availability === 'unavailable'
      ? record.availability
      : null
  const agent =
    isForegroundRecognizedProvider(record.agent) || record.agent === null ? record.agent : undefined
  const exitCode = record.exitCode === null ? null : normalizeOptionalFiniteInt(record.exitCode)
  if (
    !sessionId ||
    observedAtMs === null ||
    observedAtMs < 0 ||
    !source ||
    !availability ||
    agent === undefined ||
    typeof record.shellOnly !== 'boolean' ||
    (record.exitCode !== null && exitCode === null)
  ) {
    return null
  }

  const base = {
    sessionId,
    observedAtMs,
  }
  if (source === 'process_scan' && exitCode === null) {
    if (availability === 'available') {
      return { ...base, source, exitCode, availability, agent, shellOnly: record.shellOnly }
    }
    if (agent === null && record.shellOnly === false) {
      return { ...base, source, exitCode, availability, agent, shellOnly: false }
    }
  }
  if (
    source === 'windows_exit_code' &&
    exitCode !== null &&
    availability === 'unavailable' &&
    agent === null &&
    record.shellOnly === false
  ) {
    return { ...base, source, exitCode, availability, agent, shellOnly: false }
  }
  if (
    source === 'windows_prompt_timeout' &&
    exitCode === null &&
    availability === 'unavailable' &&
    agent === null &&
    record.shellOnly === false
  ) {
    return { ...base, source, exitCode, availability, agent, shellOnly: false }
  }
  return null
}
