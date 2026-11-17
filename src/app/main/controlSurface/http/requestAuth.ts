import type { IncomingMessage } from 'node:http'
import type { SessionGrant, SessionGrantRegistry } from './sessionGrantRegistry'
import { timingSafeEqual } from 'node:crypto'
import type { WebSessionManager } from './webSessionManager'

function normalizeBearerToken(value: string | undefined): string | null {
  if (!value) {
    return null
  }

  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return null
  }

  if (!trimmed.toLowerCase().startsWith('bearer ')) {
    return null
  }

  const token = trimmed.slice('bearer '.length).trim()
  return token.length > 0 ? token : null
}

function tokensEqual(a: string, b: string): boolean {
  // Avoid leaking token length timing.
  const aBytes = Buffer.from(a, 'utf8')
  const bBytes = Buffer.from(b, 'utf8')
  if (aBytes.length !== bBytes.length) {
    return false
  }

  return timingSafeEqual(aBytes, bBytes)
}

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) {
    return {}
  }

  const parts = header.split(';')
  if (parts.length === 0) {
    return {}
  }

  const cookies: Record<string, string> = {}
  for (const part of parts) {
    const [rawKey, ...rest] = part.split('=')
    const key = rawKey?.trim()
    if (!key) {
      continue
    }

    const value = rest.join('=').trim()
    if (!value) {
      continue
    }

    cookies[key] = value
  }

  return cookies
}

function resolveOriginHeader(req: IncomingMessage): string | null {
  const raw = req.headers.origin
  if (typeof raw !== 'string') {
    return null
  }

  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : null
}

function resolveRefererHeader(req: IncomingMessage): string | null {
  const raw = req.headers.referer
  if (typeof raw !== 'string') {
    return null
  }

  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : null
}

function matchesHostHeader(candidateUrl: string, hostRaw: string): boolean {
  try {
    const parsed = new URL(candidateUrl)
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.host === hostRaw
  } catch {
    return false
  }
}

function resolveHostHeader(req: IncomingMessage): string {
  return typeof req.headers.host === 'string' ? req.headers.host.trim() : ''
}

/**
 * Token-authenticated callers (CLI, Desktop main process, other Workers, server-side proxies) do
 * not send an Origin header. A browser always does for cross-origin requests and WebSocket
 * upgrades, so a token that arrives with a foreign Origin was attached by something other than
 * the page that owns this host (for example a proxy that injects the token for every request).
 */
export function isOriginAllowedForTokenAuth(req: IncomingMessage): boolean {
  const originRaw = resolveOriginHeader(req)
  if (!originRaw) {
    return true
  }

  const hostRaw = resolveHostHeader(req)
  return hostRaw.length > 0 && matchesHostHeader(originRaw, hostRaw)
}

function isSameOriginRequest(req: IncomingMessage): boolean {
  const originRaw = resolveOriginHeader(req)
  const hostRaw = resolveHostHeader(req)
  if (hostRaw.length === 0) {
    return false
  }

  if (originRaw) {
    return matchesHostHeader(originRaw, hostRaw)
  }

  const refererRaw = resolveRefererHeader(req)
  if (refererRaw) {
    return matchesHostHeader(refererRaw, hostRaw)
  }

  const fetchSiteRaw = req.headers['sec-fetch-site'] as string | string[] | undefined
  let fetchSite = ''
  if (typeof fetchSiteRaw === 'string') {
    fetchSite = fetchSiteRaw.trim().toLowerCase()
  } else if (Array.isArray(fetchSiteRaw)) {
    fetchSite = fetchSiteRaw[0]?.trim().toLowerCase() ?? ''
  }

  return fetchSite === 'same-origin' || fetchSite === 'none'
}

export type RequestAuth =
  | { kind: 'session-grant'; grant: SessionGrant }
  | {
      kind: 'bearer'
    }
  | {
      kind: 'cookie'
      webSessionGeneration: number
      /** Internal credential reference; never returned or logged. */
      webSessionCookie?: string
    }
  | {
      kind: 'query_token'
    }

export function resolveRequestAuth(options: {
  req: IncomingMessage
  url: URL
  token: string
  sessionGrants?: Pick<SessionGrantRegistry, 'verify'>
  webSessions: WebSessionManager
  allowQueryToken: boolean
  now: Date
}): RequestAuth | null {
  const bearer = normalizeBearerToken(options.req.headers.authorization)
  if (bearer && tokensEqual(bearer, options.token)) {
    return isOriginAllowedForTokenAuth(options.req) ? { kind: 'bearer' } : null
  }

  if (bearer) {
    const grant = options.sessionGrants?.verify(bearer)
    if (grant) {
      return { kind: 'session-grant', grant }
    }
    // An invalid bearer must not fall through to a more privileged cookie.
    return null
  }

  const cookies = parseCookies(
    typeof options.req.headers.cookie === 'string' ? options.req.headers.cookie : undefined,
  )
  const sessionCookie = cookies[options.webSessions.cookieName()]
  const webSessionGeneration = sessionCookie
    ? options.webSessions.resolveCookieGeneration(options.now, sessionCookie)
    : null
  if (webSessionGeneration !== null) {
    if (!isSameOriginRequest(options.req)) {
      return null
    }

    return Object.defineProperty(
      { kind: 'cookie' as const, webSessionGeneration },
      'webSessionCookie',
      { value: sessionCookie },
    )
  }

  if (options.allowQueryToken) {
    const queryToken = options.url.searchParams.get('token')?.trim() ?? null
    if (queryToken && tokensEqual(queryToken, options.token)) {
      return isOriginAllowedForTokenAuth(options.req) ? { kind: 'query_token' } : null
    }
  }

  return null
}
