import type { IncomingMessage, ServerResponse } from 'node:http'

/** Upper bound for a single control-surface request body (POST /invoke). */
export const MAX_INVOKE_BODY_BYTES = 16 * 1024 * 1024

export class HttpBodyTooLargeError extends Error {
  public constructor(maxBytes: number) {
    super(`Request body exceeds ${maxBytes} bytes.`)
    this.name = 'HttpBodyTooLargeError'
  }
}

/** True when the Content-Type header names JSON (`application/json`, parameters allowed). */
export function isJsonContentType(header: string | string[] | undefined): boolean {
  const raw = Array.isArray(header) ? header[0] : header
  if (typeof raw !== 'string') {
    return false
  }

  const mediaType = raw.split(';')[0]?.trim().toLowerCase() ?? ''
  return mediaType === 'application/json'
}

/** The declared Content-Length, or null when absent or malformed. */
export function readDeclaredContentLength(req: IncomingMessage): number | null {
  const raw = req.headers?.['content-length']
  if (typeof raw !== 'string' || !/^\d+$/.test(raw.trim())) {
    return null
  }

  return Number.parseInt(raw.trim(), 10)
}

export async function readJsonBody(
  req: IncomingMessage,
  options: { maxBytes?: number } = {},
): Promise<unknown> {
  const maxBytes = options.maxBytes ?? Number.POSITIVE_INFINITY
  const declaredLength = readDeclaredContentLength(req)
  if (declaredLength !== null && declaredLength > maxBytes) {
    throw new HttpBodyTooLargeError(maxBytes)
  }

  return await new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = []
    let totalBytes = 0
    let overflowed = false

    req.on('data', chunk => {
      if (overflowed) {
        return
      }

      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      totalBytes += buffer.length
      if (totalBytes > maxBytes) {
        // Stop buffering; the remaining bytes are discarded while the caller answers 413.
        overflowed = true
        chunks.length = 0
        reject(new HttpBodyTooLargeError(maxBytes))
        return
      }

      chunks.push(buffer)
    })

    req.once('error', reject)
    req.once('end', () => {
      if (overflowed) {
        return
      }

      const raw = Buffer.concat(chunks).toString('utf8')
      if (raw.trim().length === 0) {
        resolveBody(null)
        return
      }

      try {
        resolveBody(JSON.parse(raw))
      } catch (error) {
        reject(error)
      }
    })
  })
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(`${JSON.stringify(body)}\n`)
}
