import { CONTROL_SURFACE_PROTOCOL_VERSION } from '../../../shared/contracts/controlSurface'
import type { PluginInstallationManager } from '../../../contexts/plugins/application/PluginInstallationManager'
import { tryHandlePluginAssetRoute } from './pluginAssetRoutes'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createAppErrorDescriptor } from '../../../shared/errors/appError'
import type { ApprovedWorkspaceStore } from '../../../contexts/workspace/infrastructure/approval/ApprovedWorkspaceStore'
import type { PersistenceStore } from '../../../platform/persistence/sqlite/PersistenceStore'
import type { ControlSurface } from './controlSurface'
import type { ControlSurfaceContext } from './types'
import { normalizeInvokeRequest } from './validate'
import { renderWorkerWebShellPage } from './workerWebShellPage'
import { tryResolveWebUiResponse } from './webUiAssets'
import type { WebSessionManager } from './http/webSessionManager'
import {
  HttpBodyTooLargeError,
  isJsonContentType,
  MAX_INVOKE_BODY_BYTES,
  readJsonBody,
  sendJson,
} from './http/httpJson'
import { resolveRequestAuth, type RequestAuth } from './http/requestAuth'
import { writeSseEvent, type SyncEventPayload } from './http/syncSse'
import { tryHandleWebAuthRoutes } from './http/webAuthRoutes'
import { gateWebUiEntrypoint } from './http/webUiEntryGate'
import { publishSyncEvent } from './http/publishSyncEvent'
import { shouldAllowDevWebUiOrigin } from './http/devWebUiOrigin'
import { buildUnauthorizedResult } from './http/unauthorizedResult'
import {
  applyWebUiAssetSecurityHeaders,
  applyWebUiHtmlSecurityHeaders,
  isHtmlContentType,
} from './http/webUiSecurityHeaders'
import { FILE_DROP_PATH, handleFileDropRoute } from './http/fileDropRoute'
import type { WorkerVoiceRuntime } from '../../../contexts/voice/presentation/worker/createWorkerVoiceRuntime'
import {
  handleVoiceRoute,
  hasVoiceCsrfHeader,
  isVoiceRoutePath,
} from '../../../contexts/voice/presentation/worker/voiceRoutes'
import {
  handleCanvasImageRoute,
  isCanvasImageMutation,
  isCanvasImageRoute,
} from './http/canvasImageRoutes'
import type {
  ControlSurfaceHttpListenerOptions,
  ControlSurfaceHttpListenerRequestContext,
  ControlSurfaceWebAccessPolicy,
} from './controlSurfaceHttpRuntime.contract'

const MAX_SYNC_EVENT_BUFFER = 256

export interface ControlSurfaceHttpRequestHandlerDeps {
  plugins: PluginInstallationManager
  ctx: ControlSurfaceContext
  token: string
  webSessions: WebSessionManager
  controlSurface: ControlSurface
  getPersistenceStore: () => Promise<PersistenceStore>
  syncClients: Set<ServerResponse>
  syncEventBuffer: SyncEventPayload[]
  desktopSyncEventSink?: (payload: SyncEventPayload) => number
  getWebAccessPolicy: () => ControlSurfaceWebAccessPolicy
  isRuntimeClosed: () => boolean
  /** Accept `?token=` on /events (browsers cannot set headers on EventSource). Off by default. */
  allowQueryToken?: boolean
  /** Serve the `/debug/shell` page. Off by default. */
  enableDebugRoutes?: boolean
  maxInvokeBodyBytes?: number
  /** Where files dropped onto a terminal in the Web UI are kept; unset turns the route off. */
  dropsDirectory?: string
  /** Where canvas images are kept (`<userData>/canvas-images`); unset turns the routes off. */
  canvasImagesDirectory?: string
  /** Decides where a file dropped onto the canvas may go (`x-drop-directory`); unset refuses. */
  approvedWorkspaces?: ApprovedWorkspaceStore
  /** Speech in and out (`/voice/*`); unset leaves those paths unknown. */
  voice?: WorkerVoiceRuntime
}

function listenerAllowsAuth(
  role: ControlSurfaceHttpListenerOptions['role'],
  auth: RequestAuth,
): boolean {
  if (role === 'private') {
    return auth.kind === 'bearer' || auth.kind === 'query_token'
  }

  return true
}

function listenerServesWeb(role: ControlSurfaceHttpListenerOptions['role']): boolean {
  return role === 'combined' || role === 'web'
}

function requiresPrivateBearer(operationId: string): boolean {
  return operationId.startsWith('worker.')
}

function sendInvalidInvokeRequest(res: ServerResponse, status: number, debugMessage: string): void {
  sendJson(res, status, {
    __opencoveControlEnvelope: true,
    ok: false,
    error: createAppErrorDescriptor('common.invalid_input', { debugMessage }),
  })
}

function sendForbidden(res: ServerResponse): void {
  sendJson(res, 403, {
    __opencoveControlEnvelope: true,
    ok: false,
    error: createAppErrorDescriptor('control_surface.unauthorized'),
  })
}

/**
 * Auth for the raw file routes: the same as /invoke (no `?token=`). Requests that store or remove
 * something must also carry `x-opencove-drop: 1`, which plain cross-site form posts cannot set.
 */
function isAuthorizedFileRequest(options: {
  deps: ControlSurfaceHttpRequestHandlerDeps
  req: IncomingMessage
  url: URL
  listener: ControlSurfaceHttpListenerRequestContext
  requireCustomHeader: boolean
}): boolean {
  const { deps, req } = options
  const auth = resolveRequestAuth({
    req,
    url: options.url,
    token: deps.token,
    webSessions: deps.webSessions,
    allowQueryToken: false,
    now: deps.ctx.now(),
  })
  return (
    auth !== null &&
    listenerAllowsAuth(options.listener.role, auth) &&
    (!options.requireCustomHeader || req.headers['x-opencove-drop'] === '1')
  )
}

export function createControlSurfaceHttpRequestHandler(
  deps: ControlSurfaceHttpRequestHandlerDeps,
): (input: {
  req: IncomingMessage
  res: ServerResponse
  listener: ControlSurfaceHttpListenerRequestContext
  listenerSyncClients: Set<ServerResponse>
}) => Promise<void> {
  return async ({ req, res, listener, listenerSyncClients }) => {
    if (deps.isRuntimeClosed()) {
      res.statusCode = 503
      res.end()
      return
    }

    if (!req.url) {
      res.statusCode = 400
      res.end()
      return
    }

    const url = new URL(req.url, 'http://localhost')
    const servesWeb = listenerServesWeb(listener.role)
    if (await tryHandlePluginAssetRoute({ req, res, url, plugins: deps.plugins })) {
      return
    }

    if (
      servesWeb &&
      (await tryHandleWebAuthRoutes({
        req,
        res,
        url,
        now: deps.ctx.now,
        webSessions: deps.webSessions,
        webUiPasswordHash: listener.webUiPasswordHash,
        isWebUiAuthRevisionCurrent: listener.isWebUiAuthRevisionCurrent,
      }))
    ) {
      return
    }

    if (deps.canvasImagesDirectory && isCanvasImageRoute(url.pathname)) {
      if (
        !isAuthorizedFileRequest({
          deps,
          req,
          url,
          listener,
          requireCustomHeader: isCanvasImageMutation(req.method),
        })
      ) {
        req.resume()
        sendJson(res, 401, buildUnauthorizedResult())
        return
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
      return
    }

    if (req.method === 'GET') {
      if (
        servesWeb &&
        gateWebUiEntrypoint({
          req,
          res,
          url,
          token: deps.token,
          webSessions: deps.webSessions,
          enableWebShell: listener.enableWebShell,
          webUiPasswordHash: listener.webUiPasswordHash,
          now: deps.ctx.now(),
        })
      ) {
        return
      }

      if (
        servesWeb &&
        listener.enableWebShell &&
        deps.enableDebugRoutes === true &&
        url.pathname === '/debug/shell'
      ) {
        const host = typeof req.headers.host === 'string' ? req.headers.host : ''
        res.statusCode = 200
        res.setHeader('content-type', 'text/html; charset=utf-8')
        applyWebUiHtmlSecurityHeaders(res)
        res.end(renderWorkerWebShellPage({ host }))
        return
      }

      const webUiResponse =
        servesWeb &&
        listener.enableWebShell &&
        url.pathname !== '/events' &&
        !url.pathname.startsWith('/auth/')
          ? tryResolveWebUiResponse(url.pathname, {
              allowDevOrigin: shouldAllowDevWebUiOrigin(
                typeof req.headers.host === 'string' ? req.headers.host : null,
              ),
            })
          : null

      if (webUiResponse) {
        res.statusCode = webUiResponse.statusCode
        res.setHeader('content-type', webUiResponse.contentType)
        if (isHtmlContentType(webUiResponse.contentType)) {
          applyWebUiHtmlSecurityHeaders(res)
        } else {
          applyWebUiAssetSecurityHeaders(res)
        }
        res.end(webUiResponse.body)
        return
      }

      if (url.pathname === '/events') {
        const auth = resolveRequestAuth({
          req,
          url,
          token: deps.token,
          webSessions: deps.webSessions,
          allowQueryToken: deps.allowQueryToken === true,
          now: deps.ctx.now(),
        })
        if (!auth || !listenerAllowsAuth(listener.role, auth)) {
          sendJson(res, 401, buildUnauthorizedResult())
          return
        }

        const afterRevisionRaw =
          url.searchParams.get('afterRevision') ??
          (req.headers['last-event-id'] as string | undefined)
        const afterRevisionParsed =
          typeof afterRevisionRaw === 'string' ? Number.parseInt(afterRevisionRaw, 10) : NaN
        const afterRevision =
          Number.isFinite(afterRevisionParsed) && afterRevisionParsed >= 0
            ? afterRevisionParsed
            : null

        res.statusCode = 200
        res.setHeader('content-type', 'text/event-stream; charset=utf-8')
        res.setHeader('cache-control', 'no-cache, no-transform')
        res.setHeader('connection', 'keep-alive')
        res.setHeader('x-accel-buffering', 'no')
        res.write(':\n\n')

        if (
          afterRevision !== null &&
          deps.syncEventBuffer.length > 0 &&
          afterRevision < deps.syncEventBuffer[0].revision - 1
        ) {
          try {
            const store = await deps.getPersistenceStore()
            writeSseEvent(res, {
              type: 'resync_required',
              revision: await store.readAppStateRevision(),
            })
          } catch {
            // ignore
          }
        } else if (afterRevision !== null && deps.syncEventBuffer.length > 0) {
          for (const payload of deps.syncEventBuffer) {
            if (payload.revision <= afterRevision) {
              continue
            }
            try {
              writeSseEvent(res, payload)
            } catch {
              break
            }
          }
        }

        deps.syncClients.add(res)
        listenerSyncClients.add(res)
        req.on('close', () => {
          deps.syncClients.delete(res)
          listenerSyncClients.delete(res)
        })
        return
      }
    }

    if (req.method === 'POST' && url.pathname === FILE_DROP_PATH && deps.dropsDirectory) {
      if (!isAuthorizedFileRequest({ deps, req, url, listener, requireCustomHeader: true })) {
        req.resume()
        sendJson(res, 401, buildUnauthorizedResult())
        return
      }
      await handleFileDropRoute({
        req,
        res,
        dropsDirectory: deps.dropsDirectory,
        now: deps.ctx.now(),
        approvedWorkspaces: deps.approvedWorkspaces,
      })
      return
    }

    if (req.method === 'POST' && deps.voice && isVoiceRoutePath(url.pathname)) {
      if (!isAuthorizedFileRequest({ deps, req, url, listener, requireCustomHeader: false })) {
        req.resume()
        sendJson(res, 401, buildUnauthorizedResult())
        return
      }
      // Authenticated, but not from the Web UI's own code: a cross-site post cannot set it.
      if (!hasVoiceCsrfHeader(req)) {
        req.resume()
        sendJson(res, 403, buildUnauthorizedResult())
        return
      }
      await handleVoiceRoute({
        req,
        res,
        pathname: url.pathname,
        service: deps.voice.service,
        gate: deps.voice.gate,
      })
      return
    }

    if (req.method !== 'POST' || req.url !== '/invoke') {
      res.statusCode = 404
      res.end()
      return
    }

    const auth = resolveRequestAuth({
      req,
      url,
      token: deps.token,
      webSessions: deps.webSessions,
      allowQueryToken: false,
      now: deps.ctx.now(),
    })
    if (!auth || !listenerAllowsAuth(listener.role, auth)) {
      sendJson(res, 401, buildUnauthorizedResult())
      return
    }

    const clientProtocol = req.headers['x-opencove-protocol']
    if (
      clientProtocol !== undefined &&
      clientProtocol !== String(CONTROL_SURFACE_PROTOCOL_VERSION)
    ) {
      sendJson(res, 200, {
        __opencoveControlEnvelope: true,
        ok: false,
        error: createAppErrorDescriptor('common.protocol_incompatible', {
          params: {
            client: Array.isArray(clientProtocol) ? clientProtocol.join(', ') : clientProtocol,
            server: CONTROL_SURFACE_PROTOCOL_VERSION,
          },
        }),
      })
      return
    }

    if (!isJsonContentType(req.headers['content-type'])) {
      sendInvalidInvokeRequest(res, 415, 'POST /invoke requires Content-Type: application/json.')
      return
    }

    let body: unknown
    try {
      body = await readJsonBody(req, {
        maxBytes: deps.maxInvokeBodyBytes ?? MAX_INVOKE_BODY_BYTES,
      })
    } catch (error) {
      if (error instanceof HttpBodyTooLargeError) {
        res.setHeader('connection', 'close')
        sendInvalidInvokeRequest(res, 413, error.message)
        return
      }
      sendInvalidInvokeRequest(
        res,
        400,
        error instanceof Error ? error.message : 'Invalid request payload.',
      )
      return
    }

    try {
      const request = normalizeInvokeRequest(body)
      if (
        requiresPrivateBearer(request.id) &&
        (listener.role === 'web' || auth.kind !== 'bearer')
      ) {
        sendForbidden(res)
        return
      }

      if (
        request.id === 'auth.issueWebSessionTicket' &&
        (deps.getWebAccessPolicy().passwordRequired || auth.kind !== 'bearer')
      ) {
        sendForbidden(res)
        return
      }

      const shouldCheckRevision = request.kind === 'command'
      const revisionBefore = shouldCheckRevision
        ? await (await deps.getPersistenceStore()).readAppStateRevision()
        : null
      const result = await deps.controlSurface.invoke(deps.ctx, request)
      if (shouldCheckRevision) {
        try {
          const revisionAfter = await (await deps.getPersistenceStore()).readAppStateRevision()
          if (typeof revisionBefore === 'number' && revisionAfter !== revisionBefore) {
            publishSyncEvent({
              syncClients: deps.syncClients,
              syncEventBuffer: deps.syncEventBuffer,
              maxBufferSize: MAX_SYNC_EVENT_BUFFER,
              desktopSink: deps.desktopSyncEventSink,
              payload: {
                type: 'app_state.updated',
                revision: revisionAfter,
                operationId: request.id,
              },
            })
          }
        } catch {
          // ignore
        }
      }
      sendJson(res, 200, result)
    } catch (error) {
      sendJson(res, 400, {
        __opencoveControlEnvelope: true,
        ok: false,
        error: createAppErrorDescriptor('common.invalid_input', {
          debugMessage: error instanceof Error ? error.message : 'Invalid request payload.',
        }),
      })
    }
  }
}
