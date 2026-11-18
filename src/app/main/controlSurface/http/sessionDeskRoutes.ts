// Session Desk: the worker's own raw HTTP routes, beside upstream's /invoke and /events:
// canvas images, files dropped from the Web UI, and speech (/voice/*).
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ApprovedWorkspaceStore } from '../../../../contexts/workspace/infrastructure/approval/ApprovedWorkspaceStore'
import { resolve } from 'node:path'
import type { ControlSurface } from '../controlSurface'
import {
  createWorkerVoiceRuntime,
  type WorkerVoiceRuntime,
} from '../../../../contexts/voice/presentation/worker/createWorkerVoiceRuntime'
import { resolveCanvasImageStoreDir } from '../../../../contexts/workspace/infrastructure/canvasImages/canvasImageStore'
import {
  handleVoiceRoute,
  hasVoiceCsrfHeader,
  isVoiceRoutePath,
} from '../../../../contexts/voice/presentation/worker/voiceRoutes'
import { sendJson } from './httpJson'
import { FILE_DROP_PATH, handleFileDropRoute } from './fileDropRoute'
import {
  handleCanvasImageRoute,
  isCanvasImageMutation,
  isCanvasImageRoute,
} from './canvasImageRoutes'
import { buildUnauthorizedResult } from './unauthorizedResult'

export interface SessionDeskRouteDeps {
  /** Where files dropped onto a terminal in the Web UI are kept; unset turns the route off. */
  dropsDirectory?: string
  /** Where canvas images are kept (`<userData>/canvas-images`); unset turns the routes off. */
  canvasImagesDirectory?: string
  /** Decides where a file dropped onto the canvas may go (`x-drop-directory`); unset refuses. */
  approvedWorkspaces?: ApprovedWorkspaceStore
  /** Speech in and out (`/voice/*`); unset leaves those paths unknown. */
  voice?: WorkerVoiceRuntime
}

/** The worker's voice runtime, the stores behind these routes and the fork's request flags. */
export function createSessionDeskRouteDeps(
  controlSurface: ControlSurface,
  options: {
    userDataPath: string
    approvedWorkspaces?: ApprovedWorkspaceStore
    allowQueryToken?: boolean
    enableDebugRoutes?: boolean
  },
): SessionDeskRouteDeps & {
  voice: WorkerVoiceRuntime
  allowQueryToken: boolean
  enableDebugRoutes: boolean
} {
  const voice = createWorkerVoiceRuntime({
    env: process.env,
    reportIssue: message => process.stderr.write(`${message}\n`),
  })
  voice.registerHandlers(controlSurface)
  return {
    // Off unless the worker was started with them (docs/dhx/RELEASES.md, #4).
    allowQueryToken: options.allowQueryToken === true,
    enableDebugRoutes: options.enableDebugRoutes === true,
    dropsDirectory: resolve(options.userDataPath, 'drops'),
    canvasImagesDirectory: resolveCanvasImageStoreDir(options.userDataPath),
    approvedWorkspaces: options.approvedWorkspaces,
    voice,
  }
}

function refuse(req: IncomingMessage, res: ServerResponse, status: 401 | 403): void {
  req.resume()
  sendJson(res, status, buildUnauthorizedResult())
}

/** Handles the request when it is one of these routes; returns false otherwise. */
export async function tryHandleSessionDeskRoute(input: {
  deps: SessionDeskRouteDeps
  req: IncomingMessage
  res: ServerResponse
  url: URL
  now: () => Date
  /** Same auth as /invoke; `requireCustomHeader` also asks for `x-opencove-drop: 1`. */
  isAuthorized: (requireCustomHeader: boolean) => boolean
}): Promise<boolean> {
  const { deps, req, res, url, isAuthorized } = input

  if (deps.canvasImagesDirectory && isCanvasImageRoute(url.pathname)) {
    if (!isAuthorized(isCanvasImageMutation(req.method))) {
      refuse(req, res, 401)
      return true
    }
    try {
      await handleCanvasImageRoute({
        req,
        res,
        pathname: url.pathname,
        storeDirectory: deps.canvasImagesDirectory,
      })
    } catch {
      if (!res.headersSent) {
        sendJson(res, 500, { ok: false, error: 'The canvas image request failed.' })
      }
    }
    return true
  }

  if (req.method === 'POST' && url.pathname === FILE_DROP_PATH && deps.dropsDirectory) {
    if (!isAuthorized(true)) {
      refuse(req, res, 401)
      return true
    }
    await handleFileDropRoute({
      req,
      res,
      dropsDirectory: deps.dropsDirectory,
      now: input.now(),
      approvedWorkspaces: deps.approvedWorkspaces,
    })
    return true
  }

  if (req.method === 'POST' && deps.voice && isVoiceRoutePath(url.pathname)) {
    if (!isAuthorized(false)) {
      refuse(req, res, 401)
      return true
    }
    // Authenticated, but not from the Web UI's own code: a cross-site post cannot set it.
    if (!hasVoiceCsrfHeader(req)) {
      refuse(req, res, 403)
      return true
    }
    await handleVoiceRoute({
      req,
      res,
      pathname: url.pathname,
      service: deps.voice.service,
      gate: deps.voice.gate,
    })
    return true
  }

  return false
}
