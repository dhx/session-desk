/** Reads the float32 and int64 tensors of a `.safetensors` file (Pocket TTS voice states). */

export type SafetensorsTensor =
  | { dtype: 'F32'; shape: number[]; data: Float32Array }
  | { dtype: 'I64'; shape: number[]; data: BigInt64Array }

const MAX_HEADER_BYTES = 1 << 20

export function readSafetensors(bytes: Uint8Array): Map<string, SafetensorsTensor> {
  if (bytes.byteLength < 8) {
    throw new Error('safetensors file is too short')
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const headerLength = Number(view.getBigUint64(0, true))
  if (headerLength > MAX_HEADER_BYTES || 8 + headerLength > bytes.byteLength) {
    throw new Error('safetensors header is invalid')
  }
  const header = JSON.parse(
    new TextDecoder().decode(bytes.subarray(8, 8 + headerLength)),
  ) as Record<string, { dtype?: unknown; shape?: unknown; data_offsets?: unknown }>
  const base = 8 + headerLength
  const tensors = new Map<string, SafetensorsTensor>()
  for (const [name, entry] of Object.entries(header)) {
    if (name === '__metadata__') {
      continue
    }
    const shape = entry.shape
    const offsets = entry.data_offsets
    if (
      !Array.isArray(shape) ||
      !shape.every(n => Number.isInteger(n) && n >= 0) ||
      !Array.isArray(offsets) ||
      offsets.length !== 2
    ) {
      throw new Error(`safetensors entry ${name} is invalid`)
    }
    const [start, end] = offsets as [number, number]
    const count = (shape as number[]).reduce((a, b) => a * b, 1)
    if (start < 0 || end < start || base + end > bytes.byteLength) {
      throw new Error(`safetensors entry ${name} is out of range`)
    }
    // Copy so the typed array is aligned whatever the header length was. Not `bytes.slice`:
    // on a Node Buffer that is a view into a shared pool, and `.buffer` would be the whole pool.
    const raw = Uint8Array.prototype.slice.call(bytes, base + start, base + end).buffer
    if (entry.dtype === 'F32' && end - start === count * 4) {
      tensors.set(name, { dtype: 'F32', shape: shape as number[], data: new Float32Array(raw) })
    } else if (entry.dtype === 'I64' && end - start === count * 8) {
      tensors.set(name, { dtype: 'I64', shape: shape as number[], data: new BigInt64Array(raw) })
    } else {
      throw new Error(`safetensors entry ${name} has unsupported dtype ${String(entry.dtype)}`)
    }
  }
  return tensors
}
