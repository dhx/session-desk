import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  HttpBodyTooLargeError,
  readDeclaredContentLength,
  readJsonBody,
  sendJson,
} from '../../../../app/main/controlSurface/http/httpJson'
import {
  VOICE_LANGUAGES,
  type AppErrorCode,
  type VoiceLanguage,
} from '../../../../shared/contracts/dto'
import { createAppErrorDescriptor } from '../../../../shared/errors/appError'
import { encodeSpeechFrame } from '../../../../shared/voice/voiceWire'
import { VoiceMissingError, VoiceModelsMissingError } from '../../application/VoiceEngine'
import type { VoiceRequestGate } from '../../application/VoiceRequestGate'
import type { VoiceService } from '../../application/VoiceService'

/**
 * Speech in and out for the Web UI. Audio is too large for /invoke's JSON envelope, so it has
 * raw routes, authenticated like the file routes: cookie or bearer, never a query token, and a
 * custom header that a cross-site form post cannot set.
 */
export const VOICE_TRANSCRIBE_PATH = '/voice/transcribe'
export const VOICE_SPEAK_PATH = '/voice/speak'
export const VOICE_CSRF_HEADER = 'x-opencove-voice'
/** Names the browser tab, so its own requests queue while other tabs get `voice.busy`. */
export const VOICE_CLIENT_HEADER = 'x-opencove-voice-client'

const PCM_SAMPLE_RATE = 16000
const MAX_TRANSCRIBE_SECONDS = 60
/** 60 s of 16 kHz mono Int16. */
export const MAX_TRANSCRIBE_BYTES = MAX_TRANSCRIBE_SECONDS * PCM_SAMPLE_RATE * 2
export const MAX_SPEAK_TEXT_BYTES = 4 * 1024
/** Room for the JSON around the text and escaped characters. */
const MAX_SPEAK_BODY_BYTES = 4 * MAX_SPEAK_TEXT_BYTES
export { SPEECH_FRAME_HEADER_BYTES } from '../../../../shared/voice/voiceWire'

export function isVoiceRoutePath(pathname: string): boolean {
  return pathname === VOICE_TRANSCRIBE_PATH || pathname === VOICE_SPEAK_PATH
}

export function hasVoiceCsrfHeader(req: IncomingMessage): boolean {
  return req.headers[VOICE_CSRF_HEADER] === '1'
}

class VoiceRouteError extends Error {
  public constructor(
    public readonly status: number,
    public readonly code: AppErrorCode,
    message: string,
  ) {
    super(message)
  }
}

function sendVoiceError(res: ServerResponse, status: number, code: AppErrorCode, message: string) {
  sendJson(res, status, {
    ok: false,
    error: createAppErrorDescriptor(code, { debugMessage: message }),
  })
}

/**
 * Handles a POST to one of the voice paths; the caller has checked auth and the CSRF header.
 */
export async function handleVoiceRoute(options: {
  req: IncomingMessage
  res: ServerResponse
  pathname: string
  service: VoiceService
  gate: VoiceRequestGate
}): Promise<void> {
  const { req, res } = options
  const clientId = readClientId(req)
  try {
    if (options.pathname === VOICE_TRANSCRIBE_PATH) {
      const pcm16k = await readPcm16k(req)
      const result = await options.gate.run(clientId, () => options.service.transcribe(pcm16k))
      if (!result.ran) {
        throw busy()
      }
      sendJson(res, 200, { ok: true, ...result.value })
      return
    }

    const { text, language } = parseSpeakPayload(
      await readJsonBody(req, { maxBytes: MAX_SPEAK_BODY_BYTES }),
    )
    const controller = new AbortController()
    // The browser aborts the fetch when a new press interrupts the reply. Synthesis then stops
    // within a few frames.
    res.once('close', () => {
      if (!res.writableFinished) {
        controller.abort()
      }
    })
    const result = await options.gate.run(clientId, () =>
      streamSpeech(res, options.service, text, language, controller.signal),
    )
    if (!result.ran) {
      throw busy()
    }
    if (!res.headersSent) {
      startSpeechStream(res)
    }
    res.end()
  } catch (error) {
    req.resume()
    if (res.headersSent) {
      // Mid-stream: cut the response, so the browser sees an error and not a short reply.
      res.destroy()
      return
    }
    if (error instanceof VoiceRouteError) {
      sendVoiceError(res, error.status, error.code, error.message)
      return
    }
    if (error instanceof HttpBodyTooLargeError) {
      sendVoiceError(res, 413, 'common.invalid_input', error.message)
      return
    }
    if (error instanceof SyntaxError) {
      sendVoiceError(res, 400, 'common.invalid_input', 'The body is not valid JSON.')
      return
    }
    if (error instanceof VoiceModelsMissingError) {
      sendVoiceError(res, 503, 'voice.models_missing', error.message)
      return
    }
    if (error instanceof VoiceMissingError) {
      sendVoiceError(res, 503, 'voice.voice_missing', error.message)
      return
    }
    const code: AppErrorCode =
      options.pathname === VOICE_TRANSCRIBE_PATH ? 'voice.transcribe_failed' : 'voice.speak_failed'
    sendVoiceError(res, 500, code, error instanceof Error ? error.message : String(error))
  }
}

function busy(): VoiceRouteError {
  return new VoiceRouteError(409, 'voice.busy', 'Another client is using voice on this server.')
}

function readClientId(req: IncomingMessage): string {
  const raw = req.headers[VOICE_CLIENT_HEADER]
  const value = typeof raw === 'string' ? raw.trim() : ''
  return value.length > 0 && value.length <= 128 ? value : 'anonymous'
}

/** Reads raw Int16 LE mono PCM at 16 kHz, bounded while streaming, into samples in -1..1. */
async function readPcm16k(req: IncomingMessage): Promise<Float32Array> {
  const declared = readDeclaredContentLength(req)
  if (declared !== null && declared > MAX_TRANSCRIBE_BYTES) {
    throw tooMuchAudio()
  }

  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string)
    total += buffer.length
    if (total > MAX_TRANSCRIBE_BYTES) {
      throw tooMuchAudio()
    }
    chunks.push(buffer)
  }
  if (total === 0 || total % 2 !== 0) {
    throw new VoiceRouteError(
      400,
      'common.invalid_input',
      'The body must be 16 kHz mono Int16 PCM, at least one sample.',
    )
  }

  const bytes = Buffer.concat(chunks, total)
  const samples = new Float32Array(total / 2)
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = bytes.readInt16LE(index * 2) / 32768
  }
  return samples
}

function tooMuchAudio(): VoiceRouteError {
  return new VoiceRouteError(
    413,
    'common.invalid_input',
    `Recordings up to ${MAX_TRANSCRIBE_SECONDS} seconds.`,
  )
}

function parseSpeakPayload(payload: unknown): { text: string; language: VoiceLanguage } {
  if (!payload || typeof payload !== 'object') {
    throw new VoiceRouteError(400, 'common.invalid_input', 'Expected { text, language }.')
  }
  const { text, language } = payload as { text?: unknown; language?: unknown }
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new VoiceRouteError(400, 'common.invalid_input', 'text must be a non-empty string.')
  }
  if (Buffer.byteLength(text, 'utf8') > MAX_SPEAK_TEXT_BYTES) {
    throw new VoiceRouteError(413, 'common.invalid_input', 'text is limited to 4 KB.')
  }
  if (!VOICE_LANGUAGES.includes(language as VoiceLanguage)) {
    throw new VoiceRouteError(
      400,
      'common.invalid_input',
      `language must be one of ${VOICE_LANGUAGES.join(', ')}.`,
    )
  }
  return { text, language: language as VoiceLanguage }
}

function startSpeechStream(res: ServerResponse): void {
  res.statusCode = 200
  res.setHeader('content-type', 'application/octet-stream')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('x-content-type-options', 'nosniff')
}

async function streamSpeech(
  res: ServerResponse,
  service: VoiceService,
  text: string,
  language: VoiceLanguage,
  signal: AbortSignal,
): Promise<void> {
  // The client may have gone while this request waited behind its own earlier one.
  if (signal.aborted) {
    return
  }
  let sequence = 0
  await service.speak(text, language, signal, chunk => {
    if (!res.headersSent) {
      startSpeechStream(res)
    }
    const frame = encodeSpeechFrame(chunk, sequence)
    sequence += 1
    // The next audio is generated only once the socket took this, so a slow phone does not pile
    // up audio in the worker's memory.
    return writeWithBackpressure(res, frame)
  })
}

function writeWithBackpressure(res: ServerResponse, frame: Uint8Array): Promise<void> {
  if (res.destroyed) {
    return Promise.resolve()
  }
  if (res.write(frame)) {
    return Promise.resolve()
  }
  return new Promise(resolve => {
    const done = (): void => {
      res.off('drain', done)
      res.off('close', done)
      resolve()
    }
    res.once('drain', done)
    res.once('close', done)
  })
}
