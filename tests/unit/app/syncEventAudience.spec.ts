import type { IncomingMessage, ServerResponse } from 'node:http'
import { EventEmitter } from 'node:events'
import { expect, it } from 'vitest'
import {
  markSyncClientGrantScoped,
  publishLiveSyncEvent,
} from '../../../src/app/main/controlSurface/http/publishSyncEvent'
import { serveSyncEvents } from '../../../src/app/main/controlSurface/http/serveSyncEvents'
import type { SyncEventPayload } from '../../../src/shared/contracts/dto'

function client() {
  const written: string[] = []
  const res = Object.assign(new EventEmitter(), {
    write: (chunk: string) => written.push(chunk),
    end: () => undefined,
  }) as unknown as ServerResponse
  const types = () =>
    written
      .filter(chunk => chunk.startsWith('data: '))
      .map(chunk => (JSON.parse(chunk.slice(6)) as SyncEventPayload).type)
  return { res, types }
}

const appState: SyncEventPayload = { type: 'app_state.updated', revision: 5, operationId: 'op' }
const tiling: SyncEventPayload = {
  type: 'tiling.layout_updated',
  revision: 5,
  spaceId: 'space-of-another-workspace',
  layoutRevision: 2,
  operationId: 'op-1',
}

it('does not deliver tiling layout events live to the stream of a session grant', () => {
  const owner = client()
  const agent = client()
  markSyncClientGrantScoped(agent.res)
  const syncClients = new Set([owner.res, agent.res])
  publishLiveSyncEvent({ syncClients, payload: appState })
  expect(publishLiveSyncEvent({ syncClients, payload: tiling })).toBe(1)
  expect(owner.types()).toEqual(['app_state.updated', 'tiling.layout_updated'])
  expect(agent.types()).toEqual(['app_state.updated'])
})

it('does not replay tiling layout events to the stream of a session grant', async () => {
  const serve = async (grantScoped: boolean) => {
    const { res, types } = client()
    if (grantScoped) {
      markSyncClientGrantScoped(res)
    }
    await serveSyncEvents({
      req: new EventEmitter() as unknown as IncomingMessage,
      res,
      clients: new Set(),
      listenerClients: new Set(),
      buffer: [appState, tiling],
      afterRevision: 4,
      readSnapshot: async () => ({ revision: 5, state: null }),
      isRevoked: () => false,
    })
    return types()
  }
  expect(await serve(false)).toEqual([
    'app_state.updated',
    'tiling.layout_updated',
    'resync_required',
  ])
  expect(await serve(true)).toEqual(['app_state.updated', 'resync_required'])
})
