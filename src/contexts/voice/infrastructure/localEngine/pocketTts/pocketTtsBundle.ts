/**
 * The exported Pocket TTS bundle (`bundle.json`, written by scripts/voice/pocket-tts/export.py)
 * and the voice states that go with it.
 */
import type { PocketTtsTextOptions } from './pocketTtsText'
import { readSafetensors } from './safetensors'

export const POCKET_TTS_BUNDLE_FORMAT = 1
export const POCKET_TTS_GRAPHS = [
  'text_conditioner.onnx',
  'flow_lm_main.onnx',
  'flow_lm_flow.onnx',
  'mimi_decoder.onnx',
] as const

export interface MimiStateEntry {
  key: string
  dtype: 'float32' | 'int64'
  shape: number[]
  /** The attention cache: its time axis (2) is sized to the frames of one chunk. */
  growsWithFrames: boolean
}

export interface PocketTtsBundle {
  language: string
  sampleRate: number
  samplesPerFrame: number
  latentDim: number
  modelDim: number
  flowLayers: number
  kvHeads: number
  headDim: number
  flowStateModules: string[]
  eosThreshold: number
  minFramesBeforeEos: number
  tokensPerSecondEstimate: number
  genSecondsPadding: number
  frameRate: number
  framesAfterEos: number | null
  defaultTemperature: number
  samplerDecodeSteps: number
  maxTokensPerChunk: number
  mimiStepsPerLatent: number
  mimiState: MimiStateEntry[]
  text: PocketTtsTextOptions
  files: Record<string, string>
}

/** A voice: the flow model's KV cache after the voice prompt, per layer, without padding. */
export interface PocketTtsVoice {
  /** [layers, 2, 1, length, kvHeads, headDim], row-major. */
  kv: Float32Array
  length: number
}

function fail(message: string): never {
  throw new Error(`Invalid Pocket TTS bundle: ${message}`)
}

const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)
const isCount = (value: unknown): value is number => Number.isInteger(value) && Number(value) > 0

export function parsePocketTtsBundle(json: unknown): PocketTtsBundle {
  if (!json || typeof json !== 'object') {
    fail('not an object')
  }
  const b = json as Record<string, unknown>
  if (b.format !== POCKET_TTS_BUNDLE_FORMAT) {
    fail(`format ${String(b.format)}, expected ${POCKET_TTS_BUNDLE_FORMAT}`)
  }
  for (const key of [
    'sampleRate',
    'samplesPerFrame',
    'latentDim',
    'modelDim',
    'flowLayers',
    'kvHeads',
    'headDim',
    'samplerDecodeSteps',
    'maxTokensPerChunk',
    'mimiStepsPerLatent',
  ]) {
    if (!isCount(b[key])) {
      fail(`${key} must be a positive integer`)
    }
  }
  for (const key of [
    'eosThreshold',
    'minFramesBeforeEos',
    'tokensPerSecondEstimate',
    'genSecondsPadding',
    'frameRate',
    'defaultTemperature',
  ]) {
    if (!isNumber(b[key])) {
      fail(`${key} must be a number`)
    }
  }
  if (b.framesAfterEos !== null && !Number.isInteger(b.framesAfterEos)) {
    fail('framesAfterEos must be an integer or null')
  }
  if (typeof b.language !== 'string' || !b.language) {
    fail('language is missing')
  }
  const modules = b.flowStateModules
  if (!Array.isArray(modules) || modules.length !== b.flowLayers) {
    fail('flowStateModules must name one module per layer')
  }
  const mimiState = b.mimiState
  if (
    !Array.isArray(mimiState) ||
    !mimiState.every(
      (e: Record<string, unknown>) =>
        typeof e.key === 'string' &&
        (e.dtype === 'float32' || e.dtype === 'int64') &&
        Array.isArray(e.shape) &&
        e.shape.every(n => Number.isInteger(n) && n >= 0) &&
        typeof e.growsWithFrames === 'boolean',
    )
  ) {
    fail('mimiState is invalid')
  }
  const text = b.text as Record<string, unknown> | undefined
  if (
    !text ||
    typeof text.padWithSpacesForShortInputs !== 'boolean' ||
    typeof text.removeSemicolons !== 'boolean' ||
    typeof text.appendTerminalPunctuation !== 'boolean' ||
    typeof text.capitalizeFirstLetter !== 'boolean' ||
    !text.replaceCharacters ||
    typeof text.replaceCharacters !== 'object'
  ) {
    fail('text options are invalid')
  }
  const files = b.files as Record<string, unknown> | undefined
  if (
    !files ||
    ![...POCKET_TTS_GRAPHS, 'tokenizer.json'].every(f => typeof files[f] === 'string')
  ) {
    fail('files must list every graph and the tokenizer with a checksum')
  }
  return json as PocketTtsBundle
}

/**
 * Reads a voice state exported by pocket-tts (`export_model_state`): per flow layer a KV
 * `cache` [2, 1, T, heads, headDim] and an `offset`. Slots past the offset are dropped; they are
 * NaN in the file and must never reach the graph.
 */
export function readPocketTtsVoice(bytes: Uint8Array, bundle: PocketTtsBundle): PocketTtsVoice {
  const tensors = readSafetensors(bytes)
  const { kvHeads: heads, headDim } = bundle
  let length = -1
  const caches = bundle.flowStateModules.map(module => {
    const cache = tensors.get(`${module}/cache`)
    const offset = tensors.get(`${module}/offset`)
    const pad = tensors.get(`${module}/pad`)
    if (cache?.dtype !== 'F32' || offset?.dtype !== 'I64') {
      throw new Error(`Voice state has no cache for ${module}`)
    }
    if (pad && (pad.dtype !== 'I64' || pad.data.some(value => value !== 0n))) {
      throw new Error('Voice states with padding are not supported')
    }
    const [two, batch, capacity, h, d] = cache.shape
    const at = Number(offset.data[0])
    if (two !== 2 || batch !== 1 || h !== heads || d !== headDim || at < 1 || at > capacity) {
      throw new Error(`Voice state does not fit this model (${module})`)
    }
    if (length !== -1 && at !== length) {
      throw new Error('Voice state layers disagree on their length')
    }
    length = at
    return { data: cache.data, capacity }
  })
  const block = heads * headDim
  const kv = new Float32Array(bundle.flowLayers * 2 * length * block)
  caches.forEach(({ data, capacity }, layer) => {
    for (let half = 0; half < 2; half += 1) {
      const source = data.subarray(half * capacity * block, (half * capacity + length) * block)
      if (!source.every(Number.isFinite)) {
        throw new Error('Voice state contains invalid values')
      }
      kv.set(source, (layer * 2 + half) * length * block)
    }
  })
  return { kv, length }
}
