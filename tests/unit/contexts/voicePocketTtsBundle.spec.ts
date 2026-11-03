import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  parsePocketTtsBundle,
  type PocketTtsBundle,
  readPocketTtsVoice,
} from '../../../src/contexts/voice/infrastructure/localEngine/pocketTts/pocketTtsBundle'
import { readSafetensors } from '../../../src/contexts/voice/infrastructure/localEngine/pocketTts/safetensors'

type Entry = { dtype: 'F32' | 'I64'; shape: number[]; values: number[] }

/** Builds a .safetensors file as a Node Buffer, the way readFile returns it. */
function safetensors(entries: Record<string, Entry>): Buffer {
  const header: Record<string, unknown> = {}
  const parts: Buffer[] = []
  let offset = 0
  for (const [name, { dtype, shape, values }] of Object.entries(entries)) {
    const data =
      dtype === 'F32'
        ? Buffer.from(Float32Array.from(values).buffer)
        : Buffer.from(BigInt64Array.from(values.map(BigInt)).buffer)
    header[name] = { dtype, shape, data_offsets: [offset, offset + data.length] }
    parts.push(data)
    offset += data.length
  }
  const json = Buffer.from(JSON.stringify(header))
  const length = Buffer.alloc(8)
  length.writeBigUInt64LE(BigInt(json.length))
  return Buffer.concat([length, json, ...parts])
}

const bundle = {
  flowLayers: 2,
  kvHeads: 1,
  headDim: 2,
  flowStateModules: ['l0', 'l1'],
} as PocketTtsBundle

/** A cache [2, 1, capacity=3, 1, 2]: keys then values, the third slot unwritten (NaN). */
function layer(name: string, base: number, pad = 0): Record<string, Entry> {
  const slots = (k: number) => [base + k, base + k + 0.5, base + k + 1, base + k + 1.5, NaN, NaN]
  return {
    [`${name}/cache`]: {
      dtype: 'F32',
      shape: [2, 1, 3, 1, 2],
      values: [...slots(0), ...slots(10)],
    },
    [`${name}/offset`]: { dtype: 'I64', shape: [1], values: [2] },
    [`${name}/pad`]: { dtype: 'I64', shape: [1], values: [pad] },
  }
}

describe('readSafetensors', () => {
  it('reads tensors from a pooled Node Buffer', () => {
    const tensors = readSafetensors(safetensors(layer('l0', 1)))
    expect(Array.from(tensors.get('l0/offset')!.data)).toEqual([2n])
    expect(tensors.get('l0/cache')!.shape).toEqual([2, 1, 3, 1, 2])
  })

  it('rejects entries outside the file', () => {
    const bytes = safetensors(layer('l0', 1))
    expect(() => readSafetensors(bytes.subarray(0, bytes.length - 4))).toThrow('out of range')
  })
})

describe('readPocketTtsVoice', () => {
  it('keeps the written slots of every layer, keys before values', () => {
    const voice = readPocketTtsVoice(
      safetensors({ ...layer('l0', 1), ...layer('l1', 100) }),
      bundle,
    )
    expect(voice.length).toBe(2)
    expect(Array.from(voice.kv)).toEqual([
      1, 1.5, 2, 2.5, 11, 11.5, 12, 12.5, 100, 100.5, 101, 101.5, 110, 110.5, 111, 111.5,
    ])
  })

  it('refuses padded states and states for another model', () => {
    expect(() =>
      readPocketTtsVoice(safetensors({ ...layer('l0', 1, 1), ...layer('l1', 1) }), bundle),
    ).toThrow('padding')
    expect(() => readPocketTtsVoice(safetensors(layer('l0', 1)), bundle)).toThrow('no cache for l1')
  })
})

describe('parsePocketTtsBundle', () => {
  const exported = (): Record<string, unknown> =>
    JSON.parse(
      readFileSync(join(__dirname, '../../fixtures/voice/pocket-tts/bundle.german.json'), 'utf8'),
    )

  it('accepts what export.py writes', () => {
    expect(parsePocketTtsBundle(exported()).language).toBe('german')
  })

  it('names what is wrong', () => {
    expect(() => parsePocketTtsBundle({ ...exported(), format: 2 })).toThrow('format 2')
    expect(() => parsePocketTtsBundle({ ...exported(), files: {} })).toThrow('checksum')
  })
})
