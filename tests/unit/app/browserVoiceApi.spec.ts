import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBrowserVoiceApi } from '../../../src/app/renderer/browser/browserOpenCoveApi.voice'
import { encodeSpeechFrame } from '../../../src/shared/voice/voiceWire'

type FetchCall = { url: string; init: RequestInit }

function stubFetch(answer: (call: FetchCall) => Response | Promise<Response>): FetchCall[] {
  const calls: FetchCall[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const call = { url, init }
      calls.push(call)
      return await answer(call)
    }),
  )
  return calls
}

function streamOf(pieces: Uint8Array[], options: { hangAfter?: boolean } = {}): ReadableStream {
  return new ReadableStream({
    start(controller) {
      for (const piece of pieces) {
        controller.enqueue(piece)
      }
      if (!options.hangAfter) {
        controller.close()
      }
    },
  })
}

function envelope(value: unknown): Response {
  return new Response(JSON.stringify({ __opencoveControlEnvelope: true, ok: true, value }))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('browser voice bridge', () => {
  it('takes a transcript without a language, from a worker before languages, as English', async () => {
    stubFetch(() => new Response(JSON.stringify({ ok: true, text: 'hello' })))

    await expect(
      createBrowserVoiceApi().transcribe({ pcm16k: new Float32Array(1) }),
    ).resolves.toEqual({ text: 'hello', language: 'en' })
  })

  it('posts the recording as 16-bit PCM with the voice headers and answers text and language', async () => {
    const calls = stubFetch(
      () => new Response(JSON.stringify({ ok: true, text: 'hallo', language: 'de' })),
    )
    const voice = createBrowserVoiceApi()

    await expect(voice.transcribe({ pcm16k: new Float32Array([0, 0.5]) })).resolves.toEqual({
      text: 'hallo',
      language: 'de',
    })

    const [call] = calls
    expect(call.url).toBe('/voice/transcribe')
    expect(call.init.credentials).toBe('same-origin')
    const headers = call.init.headers as Record<string, string>
    expect(headers['x-opencove-voice']).toBe('1')
    expect(headers['x-opencove-voice-client']).toMatch(/.+/)
    expect((call.init.body as Uint8Array).byteLength).toBe(4)
  })

  it('keeps the same client id for every request of a tab', async () => {
    const calls = stubFetch(() => new Response(JSON.stringify({ ok: true, text: '' })))
    const voice = createBrowserVoiceApi()

    await voice.transcribe({ pcm16k: new Float32Array(1) })
    await voice.transcribe({ pcm16k: new Float32Array(1) })

    const ids = calls.map(
      call => (call.init.headers as Record<string, string>)['x-opencove-voice-client'],
    )
    expect(ids[0]).toBe(ids[1])
  })

  it('throws the worker’s error code', async () => {
    stubFetch(
      () =>
        new Response(JSON.stringify({ ok: false, error: { code: 'voice.busy' } }), { status: 409 }),
    )
    const voice = createBrowserVoiceApi()

    await expect(voice.transcribe({ pcm16k: new Float32Array(1) })).rejects.toMatchObject({
      code: 'voice.busy',
    })
  })

  it('hands each streamed frame to the chunk listeners, in order', async () => {
    const stream = new Uint8Array([
      ...encodeSpeechFrame({ sampleRate: 24000, samples: new Float32Array([0.1, 0.2]) }, 0),
      ...encodeSpeechFrame({ sampleRate: 24000, samples: new Float32Array([0.3]) }, 1),
    ])
    const calls = stubFetch(
      () => new Response(streamOf([stream.subarray(0, 5), stream.subarray(5)])),
    )
    const voice = createBrowserVoiceApi()
    const events: { requestId: string; index: number; length: number }[] = []
    voice.onSpeakChunk(event =>
      events.push({ requestId: event.requestId, index: event.index, length: event.samples.length }),
    )

    await expect(voice.speak({ requestId: 'r1', text: 'A. B.', language: 'de' })).resolves.toEqual({
      chunkCount: 2,
      cancelled: false,
    })
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ text: 'A. B.', language: 'de' })
    expect(events).toEqual([
      { requestId: 'r1', index: 0, length: 2 },
      { requestId: 'r1', index: 1, length: 1 },
    ])
  })

  it('stops reading when the speech is cancelled', async () => {
    const first = encodeSpeechFrame({ sampleRate: 24000, samples: new Float32Array(1) }, 0)
    stubFetch(
      ({ init }) =>
        new Promise<Response>(resolve => {
          const body = streamOf([first], { hangAfter: true })
          init.signal?.addEventListener('abort', () => void body.cancel().catch(() => {}))
          resolve(new Response(body))
        }),
    )
    const voice = createBrowserVoiceApi()
    let chunks = 0
    voice.onSpeakChunk(() => {
      chunks += 1
      void voice.cancelSpeak({ requestId: 'r1' })
    })

    await expect(voice.speak({ requestId: 'r1', text: 'Long.', language: 'de' })).resolves.toEqual({
      chunkCount: 1,
      cancelled: true,
    })
    expect(chunks).toBe(1)
  })

  it('fails a stream that ends inside a sentence instead of passing it off as complete', async () => {
    const frame = encodeSpeechFrame({ sampleRate: 24000, samples: new Float32Array(4) }, 0)
    stubFetch(() => new Response(streamOf([frame.subarray(0, 20)])))
    const voice = createBrowserVoiceApi()

    await expect(
      voice.speak({ requestId: 'r1', text: 'A.', language: 'de' }),
    ).rejects.toMatchObject({ code: 'voice.speak_failed' })
  })

  it('reports loading while prepare runs, then the answered status', async () => {
    stubFetch(() => envelope({ state: 'ready' }))
    const voice = createBrowserVoiceApi()
    const states: string[] = []
    voice.onStatus(status => states.push(status.state))

    await expect(voice.prepare()).resolves.toEqual({ state: 'ready' })
    expect(states).toEqual(['loading', 'ready'])
  })
})
