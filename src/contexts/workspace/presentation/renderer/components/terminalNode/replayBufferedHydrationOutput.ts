import type { Terminal } from '@xterm/xterm'
import { resolveSuffixPrefixOverlap } from './overlap'
import { findIncompleteTerminalControlSequenceStart } from './hydrationReplacement'
import { writeTerminalChunkAndCapture } from './committedScreenState'

const TERMINAL_FULL_RESET = '\u001bc'

export function replayBufferedHydrationOutput({
  terminal,
  rawSnapshot,
  bufferedData,
  bufferedExitCode,
  resetTerminalBeforeFirstWrite = false,
  inputModeReplay = '',
  scrollbackBuffer,
  committedScrollbackBuffer,
  onCommittedScreenState,
  onReplayWriteCommitted,
}: {
  terminal: Terminal
  rawSnapshot: string
  bufferedData: string
  bufferedExitCode: number | null
  resetTerminalBeforeFirstWrite?: boolean
  inputModeReplay?: string
  scrollbackBuffer: {
    append: (data: string) => void
  }
  committedScrollbackBuffer: {
    append: (data: string) => void
    snapshot: () => string
  }
  onCommittedScreenState: (rawSnapshot: string) => void
  onReplayWriteCommitted?: () => void
}): void {
  let shouldPrefixReset = resetTerminalBeforeFirstWrite
  let wroteChunk = false
  const writeChunk = (data: string): void => {
    const incompleteStart = findIncompleteTerminalControlSequenceStart(data)
    const boundary = incompleteStart === -1 ? data.length : incompleteStart
    // Never inject controls into a partially parsed CSI/OSC/DCS. Restore
    // modes at the last complete boundary, then leave the original tail open.
    const terminalData = `${shouldPrefixReset ? TERMINAL_FULL_RESET : ''}${data.slice(0, boundary)}${inputModeReplay}${data.slice(boundary)}`
    wroteChunk = true
    shouldPrefixReset = false
    writeTerminalChunkAndCapture({
      terminal,
      data,
      terminalData,
      committedScrollbackBuffer,
      onCommittedScreenState,
      onWriteCommitted: onReplayWriteCommitted,
    })
  }

  if (bufferedData.length > 0) {
    const overlap = resolveSuffixPrefixOverlap(rawSnapshot, bufferedData)
    const remainder = bufferedData.slice(overlap)

    if (remainder.length > 0) {
      writeChunk(remainder)
      scrollbackBuffer.append(remainder)
    }
  }

  if (bufferedExitCode !== null) {
    const exitMessage = `\r\n[process exited with code ${bufferedExitCode}]\r\n`
    writeChunk(exitMessage)
    scrollbackBuffer.append(exitMessage)
  }
  if (!wroteChunk && inputModeReplay) {
    terminal.write(inputModeReplay)
  }
}
