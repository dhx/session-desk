import { expect, it, vi } from 'vitest'
import { createCommittedStatePublisher } from '../../../src/app/main/controlSurface/http/committedStatePublisher'
import type { PersistenceStore } from '../../../src/platform/persistence/sqlite/PersistenceStore'
import type { AppStateCommittedObservation } from '../../../src/shared/contracts/managedClaudeLaunch'
import type { SyncEventPayload } from '../../../src/shared/contracts/dto'
import type { TilingLayoutCommitted } from '../../../src/shared/tiling/TilingLayoutStore'
it('subscribes once, deduplicates attributable callbacks, and disposes the subscription', async () => {
  let listener!: (event: AppStateCommittedObservation) => void
  const unsubscribe = vi.fn()
  const store = {
    onAppStateCommitted: vi.fn(callback => {
      listener = callback
      return unsubscribe
    }),
  } as unknown as PersistenceStore
  const sink = vi.fn(() => 1),
    buffer: SyncEventPayload[] = []
  const publisher = createCommittedStatePublisher({
    getStore: async () => store,
    syncClients: new Set(),
    buffer,
    desktopSink: sink,
  })
  await publisher.getStore()
  await publisher.getStore()
  const emit = (revision: number) =>
    listener({
      revision,
      removedNodeIds: [],
      removedRuntimeSessionIds: [],
      removedManagedRuntimeSessionIds: [],
    })
  emit(2)
  emit(3)
  publisher.publish({ revision: 2, operationId: 'session.managedClaudeActivation' })
  expect(buffer.map(e => e.revision)).toEqual([2, 3])
  expect(sink).toHaveBeenCalledTimes(2)
  expect(store.onAppStateCommitted).toHaveBeenCalledTimes(1)
  publisher.dispose()
  emit(4)
  expect(unsubscribe).toHaveBeenCalledOnce()
  expect(buffer).toHaveLength(2)
})

it('publishes each committed tiling layout change once, beside app state revisions', async () => {
  let listener!: (event: TilingLayoutCommitted) => void
  const unsubscribe = vi.fn()
  const store = {
    tilingLayouts: {
      onCommitted: vi.fn(callback => {
        listener = callback
        return unsubscribe
      }),
    },
  } as unknown as PersistenceStore
  const buffer: SyncEventPayload[] = []
  const publisher = createCommittedStatePublisher({
    getStore: async () => store,
    syncClients: new Set(),
    buffer,
  })
  await publisher.getStore()
  await publisher.getStore()
  publisher.publish({ revision: 7 })
  // The app state revision does not move with a layout: two layout events may share it.
  listener({ revision: 7, spaceId: 'space-1', layoutRevision: 2, operationId: 'op-1' })
  listener({ revision: 7, spaceId: 'space-1', layoutRevision: 3, operationId: null })
  expect(buffer.slice(1)).toEqual([
    {
      type: 'tiling.layout_updated',
      revision: 7,
      spaceId: 'space-1',
      layoutRevision: 2,
      operationId: 'op-1',
    },
    {
      type: 'tiling.layout_updated',
      revision: 7,
      spaceId: 'space-1',
      layoutRevision: 3,
      operationId: null,
    },
  ])
  expect(store.tilingLayouts!.onCommitted).toHaveBeenCalledTimes(1)
  publisher.dispose()
  listener({ revision: 7, spaceId: 'space-1', layoutRevision: 4, operationId: null })
  expect(unsubscribe).toHaveBeenCalledOnce()
  expect(buffer).toHaveLength(3)
})
