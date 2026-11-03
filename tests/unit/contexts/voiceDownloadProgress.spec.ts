import { describe, expect, it } from 'vitest'
import { createDownloadProgressTracker } from '../../../src/contexts/voice/infrastructure/localEngine/downloadProgress'

function track() {
  const reports: number[] = []
  const onEvent = createDownloadProgressTracker(progress => reports.push(progress))
  const progress = (file: string, loaded: number, total: number) =>
    onEvent({ status: 'progress', file, loaded, total })
  return { reports, onEvent, progress }
}

describe('createDownloadProgressTracker', () => {
  it('reports one overall fraction across parallel files', () => {
    const { reports, progress } = track()
    progress('flow_lm_main.onnx', 50, 100)
    progress('whisper.onnx', 50, 300)
    progress('whisper.onnx', 300, 300)
    expect(reports).toEqual([0.5, 0.87])
  })

  it('never goes down when a new file raises the total', () => {
    const { reports, progress } = track()
    progress('a.onnx', 90, 100)
    progress('b.onnx', 0, 900)
    progress('b.onnx', 450, 900)
    expect(reports).toEqual([0.9])
  })

  it('reports only when the whole percent changes', () => {
    const { reports, progress } = track()
    for (let loaded = 0; loaded <= 1_000; loaded += 1) {
      progress('a.onnx', loaded, 1_000)
    }
    expect(reports).toHaveLength(101)
  })

  it('ignores non-progress events', () => {
    const { reports, onEvent } = track()
    onEvent({ status: 'initiate', file: 'a.onnx' })
    onEvent({ status: 'done', file: 'a.onnx' })
    onEvent({ status: 'ready' })
    expect(reports).toEqual([])
  })
})
