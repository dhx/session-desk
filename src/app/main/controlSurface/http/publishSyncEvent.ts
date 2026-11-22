import type { ServerResponse } from 'node:http'
import { writeSseEvent, type SyncEventPayload } from './syncSse'

// Streams opened with an agent's session grant. The sync stream is not filtered by workspace, so
// events that name the objects of a workspace, as `tiling.layout_updated` names a Space, stay off
// them; an agent reads the layouts it may see with `space.readTilingLayout`.
const grantScopedClients = new WeakSet<ServerResponse>()

export function markSyncClientGrantScoped(client: ServerResponse): void {
  grantScopedClients.add(client)
}

export function syncClientReceives(client: ServerResponse, payload: SyncEventPayload): boolean {
  return payload.type !== 'tiling.layout_updated' || !grantScopedClients.has(client)
}

export function publishSyncEvent(options: {
  syncClients: Set<ServerResponse>
  syncEventBuffer: SyncEventPayload[]
  maxBufferSize: number
  payload: SyncEventPayload
  desktopSink?: (payload: SyncEventPayload) => number
}): number {
  options.syncEventBuffer.push(options.payload)
  if (options.syncEventBuffer.length > options.maxBufferSize) {
    options.syncEventBuffer.splice(0, options.syncEventBuffer.length - options.maxBufferSize)
  }

  return publishLiveSyncEvent(options)
}

export function publishLiveSyncEvent(options: {
  syncClients: Set<ServerResponse>
  payload: SyncEventPayload
  desktopSink?: (payload: SyncEventPayload) => number
}): number {
  let deliveredCount = 0
  try {
    deliveredCount = options.desktopSink?.(options.payload) ?? 0
  } catch {
    // A closed Desktop window must not interrupt SSE delivery or a committed write.
  }

  for (const client of options.syncClients) {
    if (!syncClientReceives(client, options.payload)) {
      continue
    }
    try {
      writeSseEvent(client, options.payload)
      deliveredCount += 1
    } catch {
      try {
        client.end()
      } catch {
        // ignore
      }

      options.syncClients.delete(client)
    }
  }

  return deliveredCount
}
