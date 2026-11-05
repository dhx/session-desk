import { describe, expect, it } from 'vitest'
import { createTerminalInputModeReplay } from '../../../src/shared/terminal/terminalInputModeReplay'

describe('terminal input-mode replay checkpoint', () => {
  it('recognizes modes in mixed output at every split point', () => {
    const data = 'text\u001b[?25;1006;1003hmore\u001b[?2004h'
    for (let split = 0; split <= data.length; split++) {
      const checkpoint = createTerminalInputModeReplay()
      checkpoint.record(data.slice(0, split))
      checkpoint.record(data.slice(split))
      expect(checkpoint.snapshot()).toBe('\u001b[?1006h\u001b[?1003h\u001b[?2004h')
    }
  })

  it('retains last-operation order, including later disables', () => {
    const checkpoint = createTerminalInputModeReplay()
    checkpoint.record('\u001b[?1006h\u001b[?1016h\u001b[?1006l')
    expect(checkpoint.snapshot()).toBe('\u001b[?1016h\u001b[?1006l')
  })

  it('does not interpret control-looking string payload text or replay queries', () => {
    const checkpoint = createTerminalInputModeReplay()
    const data = '\u001b]2;[?1006h\u0007\u001bPq[?1003h\u001b\\\u001b[c\u001b[6n'
    for (const character of data) {
      checkpoint.record(character)
    }
    expect(checkpoint.snapshot()).toBe('')
  })

  it('handles C1, C0 execution, cancellation and escape out of strings', () => {
    const checkpoint = createTerminalInputModeReplay()
    checkpoint.record('\u009d2;title\u009c\u009b?1006\u0007h')
    checkpoint.record('\u001b[?1006\u0018l')
    checkpoint.record('\u001b]title\u001b[?1003h')
    expect(checkpoint.snapshot()).toBe('\u001b[?1006h\u001b[?1003h')
  })

  it('honors an application reset and soft reset without retaining older enables', () => {
    const checkpoint = createTerminalInputModeReplay()
    checkpoint.record('\u001b[?1006;1004;2004h\u001bc')
    expect(checkpoint.snapshot()).not.toContain('h')
    checkpoint.record('\u001b[?1006;1004;2004h\u001b[!p')
    expect(checkpoint.snapshot()).toContain('\u001b[?1006h')
    expect(checkpoint.snapshot()).toContain('\u001b[?1004l\u001b[?2004l')
  })

  it('bounds incomplete controls and retained mode operations', () => {
    const checkpoint = createTerminalInputModeReplay()
    for (let i = 0; i < 1000; i++) {
      checkpoint.record('\u001b[?1006h')
    }
    checkpoint.record('\u001b[' + '?'.repeat(10000) + 'h')
    expect(checkpoint.snapshot()).toBe('\u001b[?1006h')
  })
})

it('accepts snapshot controls without corrupting a fragmented live CSI', () => {
  const checkpoint = createTerminalInputModeReplay()
  checkpoint.record('\u001b[?100')
  checkpoint.acceptSnapshot('snapshot\u001b[?2004h', 5, [])
  checkpoint.record('6h')
  expect(checkpoint.snapshot()).toBe('\u001b[?2004h\u001b[?1006h')
})
