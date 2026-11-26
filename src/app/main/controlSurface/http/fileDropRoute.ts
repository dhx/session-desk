import { lstat, mkdir, open, readdir, realpath, rm, type FileHandle } from 'node:fs/promises'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { basename, extname, isAbsolute, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ApprovedWorkspaceStore } from '../../../../contexts/workspace/infrastructure'
import { sendJson } from './httpJson'

/**
 * Files dropped or pasted onto a terminal in the Web UI.
 *
 * The desktop app pastes a dropped file's own path; a browser cannot tell the page where a file
 * lives. The Web UI therefore uploads the file here, the worker keeps it under
 * `<userData>/drops/<day>/`, and the page pastes the path it answers. Days older than a week are
 * removed on the next upload.
 *
 * Files dropped onto the canvas in the Web UI are kept with the project instead: with the header
 * `x-drop-directory: <absolute dir>` (URI-encoded) the file goes to `<dir>/dropped/`, but only when
 * `<dir>` is inside an approved workspace root. Such files stay; they are not pruned.
 */

export const FILE_DROP_PATH = '/files/drop'
export const MAX_FILE_DROP_BYTES = 100 * 1024 * 1024
export const DROP_DIRECTORY_HEADER = 'x-drop-directory'
export const PROJECT_DROP_FOLDER_NAME = 'dropped'
const KEEP_DROP_DAYS = 7

export async function handleFileDropRoute(options: {
  req: IncomingMessage
  res: ServerResponse
  dropsDirectory: string
  now: Date
  approvedWorkspaces?: ApprovedWorkspaceStore
}): Promise<void> {
  const { req, res } = options
  const declared = Number.parseInt(String(req.headers['content-length'] ?? ''), 10)
  if (Number.isFinite(declared) && declared > MAX_FILE_DROP_BYTES) {
    sendJson(res, 413, { ok: false, error: `Files up to ${MAX_FILE_DROP_BYTES / 1024 / 1024} MB.` })
    req.resume()
    return
  }

  const name = decodeHeader(req.headers['x-file-name'])
  const directoryHeader = req.headers[DROP_DIRECTORY_HEADER]

  try {
    let path: string
    if (directoryHeader === undefined) {
      path = await saveDroppedFile(options.dropsDirectory, name, req, options.now)
    } else if (!options.approvedWorkspaces) {
      throw new FileDropRejectedError(403, 'Project drops are unavailable.')
    } else {
      path = await saveDroppedFileIntoProject(
        decodeHeader(directoryHeader),
        name,
        req,
        options.approvedWorkspaces,
      )
    }
    sendJson(res, 200, { ok: true, path, uri: pathToFileURL(path).href })
  } catch (error) {
    req.resume()
    if (error instanceof FileDropTooLargeError) {
      sendJson(res, 413, { ok: false, error: error.message })
      return
    }
    if (error instanceof FileDropRejectedError) {
      sendJson(res, error.status, { ok: false, error: error.message })
      return
    }
    sendJson(res, 500, { ok: false, error: 'The file could not be saved.' })
  }
}

class FileDropTooLargeError extends Error {}

export class FileDropRejectedError extends Error {
  public constructor(
    public readonly status: 400 | 403,
    message: string,
  ) {
    super(message)
  }
}

function decodeHeader(value: string | string[] | undefined): string {
  const raw = typeof value === 'string' ? value : ''
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

/**
 * Writes the body to `<directory>/dropped/` with a safe name, never over another file.
 * `<directory>` must exist and lie inside an approved workspace root, both as given and with
 * symlinks resolved; `dropped` itself must be a real folder, not a link to somewhere else.
 */
export async function saveDroppedFileIntoProject(
  directory: string,
  name: string,
  body: AsyncIterable<Buffer | string>,
  approvedWorkspaces: ApprovedWorkspaceStore,
): Promise<string> {
  if (!isAbsolute(directory) || directory.includes('\0')) {
    throw new FileDropRejectedError(400, 'The drop directory must be an absolute path.')
  }
  let realDirectory: string
  try {
    realDirectory = await realpath(directory)
  } catch {
    throw new FileDropRejectedError(400, 'The drop directory does not exist.')
  }
  const [givenApproved, realApproved] = await Promise.all([
    approvedWorkspaces.isPathApproved(directory),
    approvedWorkspaces.isPathApproved(realDirectory),
  ])
  if (!givenApproved || !realApproved) {
    throw new FileDropRejectedError(403, 'The drop directory is outside the approved projects.')
  }
  if (!(await lstat(realDirectory)).isDirectory()) {
    throw new FileDropRejectedError(400, 'The drop directory is not a folder.')
  }
  const target = join(realDirectory, PROJECT_DROP_FOLDER_NAME)
  await mkdir(target).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'EEXIST') {
      throw error
    }
  })
  if (!(await lstat(target)).isDirectory()) {
    throw new FileDropRejectedError(403, `${target} is not a folder.`)
  }
  return await writeNewFile(target, name, body, 0o644)
}

/** Writes the body under `<dir>/<day>/` with a safe name, never over another file. */
export async function saveDroppedFile(
  dropsDirectory: string,
  name: string,
  body: AsyncIterable<Buffer | string>,
  now: Date,
): Promise<string> {
  const day = join(dropsDirectory, dayOf(now))
  await mkdir(day, { recursive: true, mode: 0o700 })
  const path = await writeNewFile(day, name, body, 0o600)
  await pruneDrops(dropsDirectory, now)
  return path
}

async function writeNewFile(
  directory: string,
  name: string,
  body: AsyncIterable<Buffer | string>,
  mode: number,
): Promise<string> {
  const { base, ext } = safeFileName(name)
  const { path, handle } = await openNewFile(directory, base, ext, 1, mode)
  let written = 0
  const limit = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      written += chunk.length
      done(
        written > MAX_FILE_DROP_BYTES
          ? new FileDropTooLargeError(`Files up to ${MAX_FILE_DROP_BYTES / 1024 / 1024} MB.`)
          : null,
        chunk,
      )
    },
  })
  try {
    await pipeline(body, limit, handle.createWriteStream())
  } catch (error) {
    await rm(path, { force: true })
    throw error
  } finally {
    await handle.close().catch(() => undefined)
  }
  return path
}

async function openNewFile(
  directory: string,
  base: string,
  ext: string,
  attempt: number,
  mode: number,
): Promise<{ path: string; handle: FileHandle }> {
  const path = join(directory, attempt === 1 ? `${base}${ext}` : `${base}-${attempt}${ext}`)
  try {
    return { path, handle: await open(path, 'wx', mode) }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST' && attempt < 1000) {
      return await openNewFile(directory, base, ext, attempt + 1, mode)
    }
    throw error
  }
}

/** Keeps letters, digits, dots, dashes and underscores; everything else becomes `_`. */
export function safeFileName(name: string): { base: string; ext: string } {
  let clean = basename(name.replaceAll('\\', '/'))
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(/^\.+/, '')
  if (clean.length > 100) {
    clean = clean.slice(-100)
  }
  if (clean === '' || clean === '_') {
    clean = 'pasted'
  }
  const ext = extname(clean)
  return { base: clean.slice(0, clean.length - ext.length), ext }
}

function dayOf(date: Date): string {
  return date.toISOString().slice(0, 10)
}

async function pruneDrops(dropsDirectory: string, now: Date): Promise<void> {
  const oldest = now.getTime() - (KEEP_DROP_DAYS + 1) * 24 * 60 * 60 * 1000
  let days: string[]
  try {
    days = await readdir(dropsDirectory)
  } catch {
    return
  }
  await Promise.all(
    days
      .filter(day => /^\d{4}-\d{2}-\d{2}$/.test(day) && Date.parse(`${day}T00:00:00Z`) < oldest)
      .map(day => rm(join(dropsDirectory, day), { recursive: true, force: true })),
  )
}
