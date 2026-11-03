import { describe, expect, it } from 'vitest'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import type { ControlSurfaceContext } from '../../../src/app/main/controlSurface/types'
import {
  VoiceModelsMissingError,
  type VoiceEngine,
} from '../../../src/contexts/voice/application/VoiceEngine'
import { VoiceService } from '../../../src/contexts/voice/application/VoiceService'
import { registerVoiceHandlers } from '../../../src/contexts/voice/presentation/worker/registerVoiceHandlers'

const ctx: ControlSurfaceContext = {
  now: () => new Date('2026-10-29T00:00:00.000Z'),
  capabilities: {
    webShell: true,
    sync: { state: true, events: true },
    sessionStreaming: {
      enabled: true,
      ptyProtocolVersion: 1,
      replayWindowMaxBytes: 1000,
      roles: { viewer: true, controller: true },
      webAuth: { ticketToCookie: true, cookieSession: true },
    },
  },
}

function createSurface(prepare: VoiceEngine['prepare']) {
  const engine: VoiceEngine = {
    id: 'local',
    prepare,
    transcribe: async () => ({ text: '', language: 'en' }),
    speak: async function* () {},
    onUnavailable: () => () => {},
    dispose: async () => {},
  }
  const controlSurface = createControlSurface()
  registerVoiceHandlers(controlSurface, { service: new VoiceService(engine) })
  return controlSurface
}

describe('voice.status', () => {
  it('is a query that reports the engine load state without loading anything', async () => {
    let prepared = 0
    const surface = createSurface(async () => {
      prepared += 1
      return []
    })

    const result = await surface.invoke(ctx, { kind: 'query', id: 'voice.status', payload: null })

    expect(result).toMatchObject({ ok: true, value: { state: 'idle' } })
    expect(prepared).toBe(0)
  })

  it('rejects a payload', async () => {
    const surface = createSurface(async () => [])

    const result = await surface.invoke(ctx, { kind: 'query', id: 'voice.status', payload: {} })

    expect(result).toMatchObject({ ok: false, error: { code: 'common.invalid_input' } })
  })
})

describe('voice.prepare', () => {
  it('is a command that loads the models and answers with the status and languages', async () => {
    const surface = createSurface(async () => [
      { language: 'de', voiceInstalled: true },
      { language: 'en', voiceInstalled: false },
    ])

    const result = await surface.invoke(ctx, {
      kind: 'command',
      id: 'voice.prepare',
      payload: null,
    })

    expect(result).toMatchObject({
      ok: true,
      value: {
        state: 'ready',
        languages: [
          { language: 'de', voiceInstalled: true },
          { language: 'en', voiceInstalled: false },
        ],
      },
    })
  })

  it('answers voice.models_missing when this server has no models', async () => {
    const surface = createSurface(async () => {
      throw new VoiceModelsMissingError('no models')
    })

    const result = await surface.invoke(ctx, {
      kind: 'command',
      id: 'voice.prepare',
      payload: null,
    })

    expect(result).toMatchObject({ ok: false, error: { code: 'voice.models_missing' } })
  })

  it('answers voice.prepare_failed for any other load failure', async () => {
    const surface = createSurface(async () => {
      throw new Error('onnxruntime exploded')
    })

    const result = await surface.invoke(ctx, {
      kind: 'command',
      id: 'voice.prepare',
      payload: null,
    })

    expect(result).toMatchObject({ ok: false, error: { code: 'voice.prepare_failed' } })
  })

  it('is not a query', async () => {
    const surface = createSurface(async () => [])

    const result = await surface.invoke(ctx, { kind: 'query', id: 'voice.prepare', payload: null })

    expect(result).toMatchObject({ ok: false })
  })
})
