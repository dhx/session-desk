import type { IncomingMessage, ServerResponse } from 'node:http'
import { MAX_CANVAS_IMAGE_BYTES } from '../../../../shared/contracts/dto'
import {
  normalizeDeleteCanvasImagePayload,
  normalizeReadCanvasImagePayload,
  normalizeWriteCanvasImagePayload,
} from '../../../../contexts/workspace/presentation/main-ipc'
import {
  deleteCanvasImageFile,
  readCanvasImageFile,
  sniffCanvasImageMimeType,
  writeCanvasImageFile,
} from '../../../../contexts/workspace/infrastructure'
import { sendJson } from './httpJson'

/**
 * Canvas images for the Web UI: the bytes the desktop app keeps through IPC, over HTTP.
 *
 * - `PUT /canvas-images/<assetId>`: raw body, `Content-Type` is the image type, optional
 *   `x-file-name` (URI-encoded). Validated like the desktop's `workspace:write-canvas-image`.
 * - `GET /canvas-images/<assetId>`: the bytes, typed from their first bytes.
 * - `DELETE /canvas-images/<assetId>`.
 *
 * The caller authenticates the request first; writes and deletes also need the custom
 * `x-opencove-drop: 1` header (checked by the caller), which plain cross-site forms cannot send.
 */

export const CANVAS_IMAGE_PATH_PREFIX = '/canvas-images/'

class CanvasImageBodyTooLargeError extends Error {}

export function isCanvasImageRoute(pathname: string): boolean {
  return pathname.startsWith(CANVAS_IMAGE_PATH_PREFIX)
}

/** True for methods that change the store and therefore need the custom header. */
export function isCanvasImageMutation(method: string | undefined): boolean {
  return method === 'PUT' || method === 'DELETE'
}

function readAssetId(pathname: string): string {
  const raw = pathname.slice(CANVAS_IMAGE_PATH_PREFIX.length)
  try {
    return decodeURIComponent(raw)
  } catch {
    return ''
  }
}

function readHeader(req: IncomingMessage, name: string): string | null {
  const value = req.headers[name]
  return typeof value === 'string' ? value : null
}

function decodeFileName(raw: string | null): string | null {
  if (raw === null) {
    return null
  }
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

async function readLimitedBody(body: AsyncIterable<Buffer | string>): Promise<Buffer> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of body) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
    total += buffer.length
    if (total > MAX_CANVAS_IMAGE_BYTES) {
      throw new CanvasImageBodyTooLargeError()
    }
    chunks.push(buffer)
  }
  return Buffer.concat(chunks)
}

function sendInvalid(res: ServerResponse, error: unknown): void {
  sendJson(res, 400, {
    ok: false,
    error: error instanceof Error ? error.message : 'Invalid canvas image request.',
  })
}

export async function handleCanvasImageRoute(options: {
  req: IncomingMessage
  res: ServerResponse
  pathname: string
  storeDirectory: string
}): Promise<void> {
  const { req, res, storeDirectory } = options
  const assetIdRaw = readAssetId(options.pathname)

  if (req.method === 'GET' || req.method === 'HEAD') {
    let assetId: string
    try {
      assetId = normalizeReadCanvasImagePayload({ assetId: assetIdRaw }).assetId
    } catch (error) {
      sendInvalid(res, error)
      return
    }
    const bytes = await readCanvasImageFile(storeDirectory, assetId)
    if (!bytes) {
      sendJson(res, 404, { ok: false, error: 'No such canvas image.' })
      return
    }
    res.statusCode = 200
    res.setHeader('content-type', sniffCanvasImageMimeType(bytes) ?? 'application/octet-stream')
    res.setHeader('content-length', String(bytes.length))
    res.setHeader('cache-control', 'private')
    res.setHeader('x-content-type-options', 'nosniff')
    res.setHeader('content-security-policy', "default-src 'none'; sandbox")
    res.end(req.method === 'HEAD' ? undefined : bytes)
    return
  }

  if (req.method === 'DELETE') {
    req.resume()
    let assetId: string
    try {
      assetId = normalizeDeleteCanvasImagePayload({ assetId: assetIdRaw }).assetId
    } catch (error) {
      sendInvalid(res, error)
      return
    }
    await deleteCanvasImageFile(storeDirectory, assetId)
    sendJson(res, 200, { ok: true })
    return
  }

  if (req.method !== 'PUT') {
    req.resume()
    res.statusCode = 405
    res.setHeader('allow', 'GET, HEAD, PUT, DELETE')
    res.end()
    return
  }

  const declared = Number.parseInt(String(req.headers['content-length'] ?? ''), 10)
  if (Number.isFinite(declared) && declared > MAX_CANVAS_IMAGE_BYTES) {
    req.resume()
    sendJson(res, 413, { ok: false, error: 'Canvas image too large.' })
    return
  }

  let bytes: Buffer
  try {
    bytes = await readLimitedBody(req)
  } catch (error) {
    if (error instanceof CanvasImageBodyTooLargeError) {
      res.setHeader('connection', 'close')
      sendJson(res, 413, { ok: false, error: 'Canvas image too large.' })
      return
    }
    throw error
  }

  let normalized: ReturnType<typeof normalizeWriteCanvasImagePayload>
  try {
    normalized = normalizeWriteCanvasImagePayload({
      assetId: assetIdRaw,
      bytes: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      mimeType: (readHeader(req, 'content-type') ?? '').split(';')[0]?.trim().toLowerCase(),
      fileName: decodeFileName(readHeader(req, 'x-file-name')),
    })
  } catch (error) {
    sendInvalid(res, error)
    return
  }

  await writeCanvasImageFile(storeDirectory, normalized.assetId, normalized.bytes)
  sendJson(res, 200, { ok: true })
}
