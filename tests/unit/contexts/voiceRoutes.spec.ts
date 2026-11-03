// @vitest-environment node
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import type { VoiceEngine } from '../../../src/contexts/voice/application/VoiceEngine'
import { VoiceRequestGate } from '../../../src/contexts/voice/application/VoiceRequestGate'
import { VoiceService } from '../../../src/contexts/voice/application/VoiceService'
import { handleVoiceRoute } from '../../../src/contexts/voice/presentation/worker/voiceRoutes'

let server: Server | null = null

afterEach(async () => {
  await new Promise<void>(resolve => (server ? server.close(() => resolve()) : resolve()))
  server = null
})

async function serve(engine: VoiceEngine, gate: VoiceRequestGate): Promise<string> {
  const service = new VoiceService(engine)
  server = createServer((req, res) => {
    void handleVoiceRoute({
      req,
      res,
      pathname: new URL(req.url!, 'http://x').pathname,
      service,
      gate,
    })
  })
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`
}

function engineWith(speak: VoiceEngine['speak']): VoiceEngine {
  return {
    id: 'local',
    prepare: async () => [
      { language: 'de', voiceInstalled: true },
      { language: 'en', voiceInstalled: false },
    ],
    transcribe: async () => ({ text: 'gehört', language: 'de' }),
    speak,
    onUnavailable: () => () => {},
    dispose: async () => {},
  }
}

describe('voice routes', () => {
  it('answers voice.busy to another tab while one tab is in a turn', async () => {
    const gate = new VoiceRequestGate()
    const origin = await serve(
      engineWith(async function* () {}),
      gate,
    )
    let release!: () => void
    const held = gate.run('tab-2', () => new Promise<void>(resolve => (release = resolve)))

    const response = await fetch(`${origin}/voice/transcribe`, {
      method: 'POST',
      headers: { 'x-opencove-voice-client': 'tab-1' },
      body: new Uint8Array(4),
    })

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ ok: false, error: { code: 'voice.busy' } })
    release()
    await held
  })

  it('stops synthesis when the browser drops the stream', async () => {
    let signalSeen: AbortSignal | null = null
    let sentences = 0
    const origin = await serve(
      engineWith(async function* (_text, _language, signal) {
        signalSeen = signal
        while (!signal.aborted && sentences < 1000) {
          sentences += 1
          yield { index: sentences, sampleRate: 24000, samples: new Float32Array(24000) }
          // eslint-disable-next-line no-await-in-loop -- A slow engine: one sentence at a time.
          await new Promise(resolve => setTimeout(resolve, 5))
        }
      }),
      new VoiceRequestGate(),
    )
    const controller = new AbortController()
    const response = await fetch(`${origin}/voice/speak`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'Lange Antwort.', language: 'de' }),
      signal: controller.signal,
    })
    const reader = response.body!.getReader()
    await reader.read()

    controller.abort()
    await new Promise(resolve => setTimeout(resolve, 100))

    expect(signalSeen!.aborted).toBe(true)
    const stoppedAt = sentences
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(sentences).toBe(stoppedAt)
    expect(stoppedAt).toBeLessThan(1000)
  })

  it('answers the transcript with the language it was heard in', async () => {
    const origin = await serve(
      engineWith(async function* () {}),
      new VoiceRequestGate(),
    )

    const response = await fetch(`${origin}/voice/transcribe`, {
      method: 'POST',
      body: new Uint8Array(4),
    })

    expect(await response.json()).toEqual({ ok: true, text: 'gehört', language: 'de' })
  })

  it('refuses a speak body without a known language, such as a Kokoro voice', async () => {
    const origin = await serve(
      engineWith(async function* () {}),
      new VoiceRequestGate(),
    )

    for (const body of [
      { text: 'Hi.', voice: 'af_heart' },
      { text: 'Hi.', language: 'fr' },
    ]) {
      // eslint-disable-next-line no-await-in-loop -- One request after the other.
      const response = await fetch(`${origin}/voice/speak`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      expect(response.status).toBe(400)
      // eslint-disable-next-line no-await-in-loop -- Reads the answer to the request above.
      expect(await response.json()).toMatchObject({ error: { code: 'common.invalid_input' } })
    }
  })

  it('answers voice.voice_missing for a language this server has no voice for', async () => {
    const origin = await serve(
      engineWith(async function* () {
        yield { index: 0, sampleRate: 24000, samples: new Float32Array(1) }
      }),
      new VoiceRequestGate(),
    )

    const response = await fetch(`${origin}/voice/speak`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'Hello.', language: 'en' }),
    })

    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ error: { code: 'voice.voice_missing' } })
  })
})
