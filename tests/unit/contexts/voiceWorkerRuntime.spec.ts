import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createVoiceHostEnv,
  resolveBundledVoiceHostEntryPath,
} from '../../../src/contexts/voice/infrastructure/localEngine/forkVoiceHost'
import { StubVoiceEngine } from '../../../src/contexts/voice/infrastructure/stubEngine/StubVoiceEngine'
import { LocalVoiceEngine } from '../../../src/contexts/voice/infrastructure/localEngine/LocalVoiceEngine'
import { createWorkerVoiceEngine } from '../../../src/contexts/voice/presentation/worker/createWorkerVoiceRuntime'

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('voice host environment', () => {
  it('keeps what Node and onnxruntime need and drops the worker secrets', () => {
    const env = createVoiceHostEnv({
      PATH: '/usr/bin',
      HOME: '/home/worker',
      LANG: 'C.UTF-8',
      TMPDIR: '/tmp',
      OMP_NUM_THREADS: '2',
      OPENCOVE_WORKER_TOKEN: 'secret-token',
      OPENCOVE_WEB_UI_PASSWORD: 'secret-password',
      GITHUB_TOKEN: 'ghp_secret',
      ANTHROPIC_API_KEY: 'sk-secret',
    })

    expect(env).toEqual({
      PATH: '/usr/bin',
      HOME: '/home/worker',
      LANG: 'C.UTF-8',
      TMPDIR: '/tmp',
      OMP_NUM_THREADS: '2',
    })
  })
})

describe('voice host entry', () => {
  it('is found next to the code, or one folder up when the code sits in a chunk', async () => {
    const out = await mkdtemp(join(tmpdir(), 'voice-entry-'))
    dirs.push(out)
    await mkdir(join(out, 'chunks'))
    await writeFile(join(out, 'voiceHost.js'), '')

    expect(resolveBundledVoiceHostEntryPath(out)).toBe(join(out, 'voiceHost.js'))
    expect(resolveBundledVoiceHostEntryPath(join(out, 'chunks'))).toBe(join(out, 'voiceHost.js'))
  })

  it('names where it looked when the entry is missing', async () => {
    const out = await mkdtemp(join(tmpdir(), 'voice-entry-'))
    dirs.push(out)

    expect(() => resolveBundledVoiceHostEntryPath(out)).toThrow(/voiceHost\.js/)
  })
})

describe('worker voice engine', () => {
  it('uses the stub engine for tests when asked to', () => {
    expect(
      createWorkerVoiceEngine({
        env: { OPENCOVE_TEST_VOICE_ENGINE: 'stub' },
        reportIssue: () => {},
      }),
    ).toBeInstanceOf(StubVoiceEngine)
  })

  it('lets end-to-end tests say which language the stub heard', async () => {
    const engine = createWorkerVoiceEngine({
      env: {
        OPENCOVE_TEST_VOICE_ENGINE: 'stub',
        OPENCOVE_TEST_VOICE_TRANSCRIPT: 'führe die Tests aus',
        OPENCOVE_TEST_VOICE_LANGUAGE: 'de',
      },
      reportIssue: () => {},
    })

    await expect(engine.transcribe(new Float32Array(1))).resolves.toEqual({
      text: 'führe die Tests aus',
      language: 'de',
    })
  })

  it('uses the local engine otherwise, without forking until it is needed', () => {
    const engine = createWorkerVoiceEngine({
      env: { OPENCOVE_VOICE_MODELS_DIR: '/opt/opencove-voice/models' },
      reportIssue: () => {},
    })

    expect(engine).toBeInstanceOf(LocalVoiceEngine)
  })
})

describe('stub voice engine', () => {
  it('transcribes to the configured text and speaks one chunk per sentence', async () => {
    const engine = new StubVoiceEngine({ transcript: 'run the tests' })
    await expect(engine.prepare(() => {})).resolves.toEqual([
      { language: 'de', voiceInstalled: true },
      { language: 'en', voiceInstalled: true },
    ])

    await expect(engine.transcribe(new Float32Array(16000))).resolves.toEqual({
      text: 'run the tests',
      language: 'en',
    })
    const chunks = []
    for await (const chunk of engine.speak('One. Two.', 'en', new AbortController().signal)) {
      chunks.push(chunk)
    }
    expect(chunks.map(chunk => chunk.index)).toEqual([0, 1])
    expect(chunks[0].sampleRate).toBe(24000)
    expect(chunks[0].samples.length).toBeGreaterThan(0)
  })

  it('stops speaking once aborted', async () => {
    const engine = new StubVoiceEngine()
    const controller = new AbortController()
    const indexes = []
    for await (const chunk of engine.speak('One. Two. Three.', 'en', controller.signal)) {
      indexes.push(chunk.index)
      controller.abort()
    }
    expect(indexes).toEqual([0])
  })
})
