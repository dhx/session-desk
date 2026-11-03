/**
 * Pocket TTS on onnxruntime-node: text → chunks → tokens → flow LM steps → Mimi → audio.
 * Mirrors `TTSModel.generate_audio_stream` of pocket-tts 4.0.1; the tests compare it against
 * scripts/voice/pocket-tts/reference.py, which in turn is checked against the PyTorch model.
 * Runs only inside the voice host process.
 */
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type * as Ort from 'onnxruntime-node'
import {
  parsePocketTtsBundle,
  POCKET_TTS_GRAPHS,
  type PocketTtsBundle,
  type PocketTtsVoice,
  readPocketTtsVoice,
} from './pocketTtsBundle'
import { preparePocketTtsPrompt, splitPocketTtsChunks } from './pocketTtsText'
import { createUnigramTokenizer, type UnigramTokenizer } from './unigramTokenizer'

type OrtModule = typeof Ort

/** Frames decoded first, so the first sound comes early; later decodes batch more frames. */
const FIRST_DECODE_FRAMES = 2
const LATER_DECODE_FRAMES = 8
/** A fresh Mimi state clicks at its first samples; pocket-tts fades the first 5 ms in. */
const FADE_IN_SECONDS = 0.005

export interface SynthesizeOptions {
  /** Defaults to the model's own (0.3). 0 makes generation deterministic. */
  temperature?: number
  /** Uniform [0, 1) source for the sampling noise; defaults to Math.random. */
  random?: () => number
  signal?: AbortSignal
  /** Receives the latent of every generated frame, for reference tests. */
  onLatent?: (latent: Float32Array) => void
}

export interface PocketTts {
  readonly bundle: PocketTtsBundle
  readonly sampleRate: number
  loadVoice(path: string): Promise<PocketTtsVoice>
  /** Yields audio as it is decoded, a few frames at a time. */
  synthesize(
    text: string,
    voice: PocketTtsVoice,
    options?: SynthesizeOptions,
  ): AsyncGenerator<Float32Array>
  release(): Promise<void>
}

function gaussian(random: () => number): number {
  let u = 0
  while (u === 0) {
    u = random()
  }
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random())
}

async function verifiedBytes(dir: string, file: string, sha256: string): Promise<Uint8Array> {
  const bytes = await readFile(join(dir, file))
  const actual = createHash('sha256').update(bytes).digest('hex')
  if (actual !== sha256) {
    throw new Error(`Pocket TTS file ${file} does not match its checksum`)
  }
  return bytes
}

export async function loadPocketTts(
  dir: string,
  ort: OrtModule,
  loadOptions: { threads?: number } = {},
): Promise<PocketTts> {
  const bundle = parsePocketTtsBundle(JSON.parse(await readFile(join(dir, 'bundle.json'), 'utf8')))
  const tokenizer: UnigramTokenizer = createUnigramTokenizer(
    JSON.parse(
      new TextDecoder().decode(
        await verifiedBytes(dir, 'tokenizer.json', bundle.files['tokenizer.json']),
      ),
    ),
  )
  const sessionOptions: Ort.InferenceSession.SessionOptions = {
    intraOpNumThreads: loadOptions.threads ?? 2,
    interOpNumThreads: 1,
    graphOptimizationLevel: 'all',
  }
  const [textConditioner, flowMain, flowNet, mimi] = await Promise.all(
    POCKET_TTS_GRAPHS.map(async file =>
      ort.InferenceSession.create(
        await verifiedBytes(dir, file, bundle.files[file]),
        sessionOptions,
      ),
    ),
  )
  const { latentDim, modelDim, flowLayers, kvHeads, headDim } = bundle
  const block = kvHeads * headDim
  const f32 = (data: Float32Array, dims: number[]) => new ort.Tensor('float32', data, dims)
  const i64 = (value: bigint) => new ort.Tensor('int64', BigInt64Array.from([value]), [1])

  const mimiState = (frames: number): Ort.Tensor[] =>
    bundle.mimiState.map(entry => {
      const dims = [...entry.shape]
      if (entry.growsWithFrames) {
        dims[2] = frames * bundle.mimiStepsPerLatent
      }
      const size = dims.reduce((a, b) => a * b, 1)
      return entry.dtype === 'int64'
        ? new ort.Tensor('int64', new BigInt64Array(size), dims)
        : f32(new Float32Array(size), dims)
    })

  async function* generateChunk(
    chunk: string,
    voice: PocketTtsVoice,
    temperature: number,
    random: () => number,
    options: SynthesizeOptions,
  ): AsyncGenerator<Float32Array> {
    const prompt = preparePocketTtsPrompt(chunk, bundle.text)
    const tokens = tokenizer.encode(prompt.text)
    const framesAfterEos = bundle.framesAfterEos ?? prompt.framesAfterEosGuess + 2
    const maxFrames = Math.ceil(
      (tokens.length / bundle.tokensPerSecondEstimate + bundle.genSecondsPadding) *
        bundle.frameRate,
    )

    // The KV cache holds the voice, then the text, then every generated frame.
    const capacity = voice.length + tokens.length + maxFrames + 1
    const kvData = new Float32Array(flowLayers * 2 * capacity * block)
    for (let row = 0; row < flowLayers * 2; row += 1) {
      kvData.set(
        voice.kv.subarray(row * voice.length * block, (row + 1) * voice.length * block),
        row * capacity * block,
      )
    }
    let kv: Ort.Tensor = f32(kvData, [flowLayers, 2, 1, capacity, kvHeads, headDim])
    let offset: Ort.Tensor = i64(BigInt(voice.length))

    const { text_embeddings: textEmbeddings } = await textConditioner.run({
      token_ids: new ort.Tensor('int64', BigInt64Array.from(tokens, BigInt), [1, tokens.length]),
    })
    const prompted = await flowMain.run({
      sequence: f32(new Float32Array(0), [1, 0, latentDim]),
      text_embeddings: textEmbeddings,
      kv,
      offset,
    })
    kv = prompted.kv_out
    offset = prompted.offset_out

    const noText = f32(new Float32Array(0), [1, 0, modelDim])
    let input = f32(new Float32Array(latentDim).fill(Number.NaN), [1, 1, latentDim])
    const steps = bundle.samplerDecodeSteps
    const std = Math.sqrt(temperature)
    let state = mimiState(maxFrames + 1)
    let pending: Float32Array[] = []
    let decodeAt = FIRST_DECODE_FRAMES
    let fadeIn = true
    let eosStep: number | null = null

    const decode = async (): Promise<Float32Array> => {
      const latents = new Float32Array(pending.length * latentDim)
      pending.forEach((latent, i) => latents.set(latent, i * latentDim))
      const feeds: Record<string, Ort.Tensor> = {
        latent: f32(latents, [1, pending.length, latentDim]),
      }
      state.forEach((tensor, i) => {
        feeds[`state_${i}`] = tensor
      })
      const out = await mimi.run(feeds)
      state = state.map((_, i) => out[`out_state_${i}`])
      pending = []
      const audio = Float32Array.from(out.audio.data as Float32Array)
      if (fadeIn) {
        const n = Math.min(audio.length, Math.round(bundle.sampleRate * FADE_IN_SECONDS))
        for (let i = 0; i < n; i += 1) {
          audio[i] *= i / Math.max(1, n - 1)
        }
        fadeIn = false
      }
      if (!audio.every(Number.isFinite)) {
        throw new Error('speech synthesis produced invalid audio')
      }
      return audio
    }

    for (let step = 0; step < maxFrames; step += 1) {
      if (options.signal?.aborted) {
        return
      }
      // eslint-disable-next-line no-await-in-loop -- Each frame depends on the one before.
      const out = await flowMain.run({ sequence: input, text_embeddings: noText, kv, offset })
      kv = out.kv_out
      offset = out.offset_out
      const eos = (out.eos_logit.data as Float32Array)[0]
      if (eos > bundle.eosThreshold && eosStep === null && step >= bundle.minFramesBeforeEos) {
        eosStep = step
      }
      if (eosStep !== null && step >= eosStep + framesAfterEos) {
        break
      }
      let x = new Float32Array(latentDim)
      if (std > 0) {
        for (let i = 0; i < latentDim; i += 1) {
          x[i] = gaussian(random) * std
        }
      }
      for (let i = 0; i < steps; i += 1) {
        // eslint-disable-next-line no-await-in-loop -- LSD steps are sequential.
        const { flow } = await flowNet.run({
          c: out.conditioning,
          s: f32(Float32Array.of(i / steps), [1, 1]),
          t: f32(Float32Array.of((i + 1) / steps), [1, 1]),
          x: f32(x, [1, latentDim]),
        })
        const delta = flow.data as Float32Array
        x = x.map((value, j) => value + delta[j] / steps)
      }
      options.onLatent?.(x)
      pending.push(x)
      input = f32(x, [1, 1, latentDim])
      if (pending.length >= decodeAt) {
        decodeAt = LATER_DECODE_FRAMES
        // eslint-disable-next-line no-await-in-loop -- Audio streams out as it is decoded.
        yield await decode()
      }
    }
    if (pending.length > 0) {
      yield await decode()
    }
  }

  return {
    bundle,
    sampleRate: bundle.sampleRate,
    loadVoice: async path => readPocketTtsVoice(await readFile(path), bundle),
    async *synthesize(text, voice, options = {}) {
      const temperature = options.temperature ?? bundle.defaultTemperature
      const random = options.random ?? Math.random
      for (const chunk of splitPocketTtsChunks(
        tokenizer,
        text,
        bundle.maxTokensPerChunk,
        bundle.text,
      )) {
        if (options.signal?.aborted) {
          return
        }
        yield* generateChunk(chunk, voice, temperature, random, options)
      }
    },
    release: async () => {
      await Promise.all([textConditioner, flowMain, flowNet, mimi].map(s => s.release()))
    },
  }
}
