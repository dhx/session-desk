/**
 * The bytes the voice routes carry, shared by the worker that writes them and the Web UI that
 * reads them. Everything is little-endian.
 *
 * - `/voice/transcribe` body: mono Int16 PCM at 16 kHz.
 * - `/voice/speak` response: the reply's audio in frames, in order, each a 12-byte header (u32
 *   sample rate, u32 sample count, u32 sequence) and then the f32 samples.
 */

export const SPEECH_FRAME_HEADER_BYTES = 12
/** A minute of 48 kHz audio; a frame of speech is well under that. */
const MAX_FRAME_SAMPLES = 48000 * 60

export interface SpeechFrame {
  sampleRate: number
  sequence: number
  samples: Float32Array
}

/** Samples in -1..1 to Int16 LE bytes, clamped. */
export function encodePcm16(samples: Float32Array): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(samples.length * 2)
  const view = new DataView(bytes.buffer)
  for (let index = 0; index < samples.length; index += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[index]))
    view.setInt16(index * 2, clamped < 0 ? clamped * 32768 : clamped * 32767, true)
  }
  return bytes
}

export function encodeSpeechFrame(
  chunk: { sampleRate: number; samples: Float32Array },
  sequence: number,
): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(SPEECH_FRAME_HEADER_BYTES + chunk.samples.length * 4)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, chunk.sampleRate, true)
  view.setUint32(4, chunk.samples.length, true)
  view.setUint32(8, sequence, true)
  for (let index = 0; index < chunk.samples.length; index += 1) {
    view.setFloat32(SPEECH_FRAME_HEADER_BYTES + index * 4, chunk.samples[index], true)
  }
  return bytes
}

/** Reads frames out of a byte stream that arrives in pieces cut anywhere. */
export class SpeechFrameDecoder {
  private pending: Uint8Array = new Uint8Array(0)

  public push(bytes: Uint8Array): SpeechFrame[] {
    this.pending = concat(this.pending, bytes)
    const frames: SpeechFrame[] = []
    while (this.pending.byteLength >= SPEECH_FRAME_HEADER_BYTES) {
      const view = new DataView(
        this.pending.buffer,
        this.pending.byteOffset,
        this.pending.byteLength,
      )
      const sampleCount = view.getUint32(4, true)
      if (sampleCount > MAX_FRAME_SAMPLES) {
        throw new Error(`speech frame of ${sampleCount} samples is not a valid frame`)
      }
      const frameBytes = SPEECH_FRAME_HEADER_BYTES + sampleCount * 4
      if (this.pending.byteLength < frameBytes) {
        break
      }
      const samples = new Float32Array(sampleCount)
      for (let index = 0; index < sampleCount; index += 1) {
        samples[index] = view.getFloat32(SPEECH_FRAME_HEADER_BYTES + index * 4, true)
      }
      frames.push({
        sampleRate: view.getUint32(0, true),
        sequence: view.getUint32(8, true),
        samples,
      })
      this.pending = this.pending.subarray(frameBytes)
    }
    return frames
  }

  /** True when bytes are left over that do not make a whole frame: the stream was cut short. */
  public hasPartialFrame(): boolean {
    return this.pending.byteLength > 0
  }
}

function concat(left: Uint8Array, right: Uint8Array): Uint8Array {
  if (left.byteLength === 0) {
    return right
  }
  const joined = new Uint8Array(left.byteLength + right.byteLength)
  joined.set(left, 0)
  joined.set(right, left.byteLength)
  return joined
}
