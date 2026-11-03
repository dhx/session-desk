// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createControlSurfaceHttpRuntime } from '../../../src/app/main/controlSurface/controlSurfaceHttpRuntime'
import { createApprovedWorkspaceStoreForPath } from '../../../src/contexts/workspace/infrastructure/approval/ApprovedWorkspaceStoreCore'
import {
  MAX_TRANSCRIBE_BYTES,
  MAX_SPEAK_TEXT_BYTES,
  SPEECH_FRAME_HEADER_BYTES,
} from '../../../src/contexts/voice/presentation/worker/voiceRoutes'
import { createInMemoryPersistenceStore } from './controlSurfaceHttpServer.sessionStreaming.testUtils'

const TOKEN = 'voice-routes-secret'

describe('voice routes (Web UI)', () => {
  let root: string
  let origin: string
  let runtime: ReturnType<typeof createControlSurfaceHttpRuntime>
  let previousEngine: string | undefined

  beforeEach(async () => {
    previousEngine = process.env.OPENCOVE_TEST_VOICE_ENGINE
    process.env.OPENCOVE_TEST_VOICE_ENGINE = 'stub'
    root = await mkdtemp(join(tmpdir(), 'opencove-voice-routes-'))
    runtime = createControlSurfaceHttpRuntime({
      userDataPath: join(root, 'profile'),
      appVersion: '0.0.0',
      token: TOKEN,
      approvedWorkspaces: createApprovedWorkspaceStoreForPath(join(root, 'approved.json')),
      createPersistenceStore: async () => createInMemoryPersistenceStore(),
      ptyRuntime: {
        spawnSession: async () => ({ sessionId: 'unused' }),
        write: () => undefined,
        resize: () => undefined,
        kill: () => undefined,
        onData: () => () => undefined,
        onExit: () => () => undefined,
      },
    })
    await runtime.ready
    const listener = runtime.listen({
      hostname: '127.0.0.1',
      bindHostname: '127.0.0.1',
      port: 0,
      role: 'combined',
      enableWebShell: true,
      webUiPasswordHash: null,
    })
    origin = `http://127.0.0.1:${(await listener.ready).port}`
  })

  afterEach(async () => {
    await runtime.dispose()
    await rm(root, { recursive: true, force: true })
    if (previousEngine === undefined) {
      delete process.env.OPENCOVE_TEST_VOICE_ENGINE
    } else {
      process.env.OPENCOVE_TEST_VOICE_ENGINE = previousEngine
    }
  })

  const post = (
    path: string,
    body: Uint8Array | string,
    headers: Record<string, string> = {},
    auth = true,
  ) =>
    fetch(`${origin}${path}`, {
      method: 'POST',
      headers: {
        ...(auth ? { authorization: `Bearer ${TOKEN}` } : {}),
        'x-opencove-voice': '1',
        'x-opencove-voice-client': 'tab-1',
        ...headers,
      },
      body,
    })

  /** One second of 16 kHz mono Int16 PCM. */
  const pcm = () => new Uint8Array(new Int16Array(16000).fill(1200).buffer)

  describe('/voice/transcribe', () => {
    it('answers the transcript for raw 16 kHz Int16 PCM', async () => {
      const response = await post('/voice/transcribe', pcm(), {
        'content-type': 'application/octet-stream',
      })

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ ok: true, text: 'stub transcript', language: 'en' })
    })

    it('needs auth, and a query token does not count', async () => {
      expect((await post('/voice/transcribe', pcm(), {}, false)).status).toBe(401)
      const queryToken = await fetch(
        `${origin}/voice/transcribe?token=${encodeURIComponent(TOKEN)}`,
        { method: 'POST', headers: { 'x-opencove-voice': '1' }, body: pcm() },
      )
      expect(queryToken.status).toBe(401)
    })

    it('refuses an authenticated request without the voice header', async () => {
      const response = await post('/voice/transcribe', pcm(), { 'x-opencove-voice': '' })

      expect(response.status).toBe(403)
    })

    it('refuses more than 60 seconds of audio', async () => {
      const response = await post('/voice/transcribe', new Uint8Array(MAX_TRANSCRIBE_BYTES + 2))

      expect(response.status).toBe(413)
      expect(MAX_TRANSCRIBE_BYTES).toBe(60 * 16000 * 2)
    })

    it('refuses an empty body or half a sample', async () => {
      expect((await post('/voice/transcribe', new Uint8Array(0))).status).toBe(400)
      expect((await post('/voice/transcribe', new Uint8Array(3))).status).toBe(400)
    })
  })

  describe('/voice/speak', () => {
    const speak = (payload: unknown, headers: Record<string, string> = {}) =>
      post('/voice/speak', JSON.stringify(payload), {
        'content-type': 'application/json',
        ...headers,
      })

    it('streams the speech in frames, in order', async () => {
      const response = await speak({ text: 'One. Two.', language: 'en' })

      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe('application/octet-stream')
      const bytes = Buffer.from(await response.arrayBuffer())
      const frames: { sampleRate: number; count: number; sequence: number }[] = []
      let offset = 0
      while (offset < bytes.length) {
        const sampleRate = bytes.readUInt32LE(offset)
        const count = bytes.readUInt32LE(offset + 4)
        const sequence = bytes.readUInt32LE(offset + 8)
        frames.push({ sampleRate, count, sequence })
        offset += SPEECH_FRAME_HEADER_BYTES + count * 4
      }
      expect(offset).toBe(bytes.length)
      expect(frames.map(frame => frame.sequence)).toEqual([0, 1])
      expect(frames.every(frame => frame.sampleRate === 24000 && frame.count > 0)).toBe(true)
    })

    it('refuses an unknown language, a Kokoro voice instead of a language, and an empty text', async () => {
      expect((await speak({ text: 'Hi.', language: 'fr' })).status).toBe(400)
      expect((await speak({ text: 'Hi.', voice: 'af_heart' })).status).toBe(400)
      expect((await speak({ text: '   ', language: 'en' })).status).toBe(400)
      expect((await post('/voice/speak', '{not json')).status).toBe(400)
    })

    it('refuses text over 4 KB', async () => {
      const response = await speak({
        text: 'a'.repeat(MAX_SPEAK_TEXT_BYTES + 1),
        language: 'en',
      })

      expect(response.status).toBe(413)
    })

    it('needs the voice header too', async () => {
      const response = await speak({ text: 'Hi.', language: 'en' }, { 'x-opencove-voice': '' })

      expect(response.status).toBe(403)
    })
  })

  it('reports the engine status over /invoke', async () => {
    const response = await fetch(`${origin}/invoke`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'command', id: 'voice.prepare', payload: null }),
    })

    expect(await response.json()).toMatchObject({ ok: true, value: { state: 'ready' } })
  })
})
