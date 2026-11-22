// @vitest-environment node
import Database from 'better-sqlite3'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { describeWithElectronNativeModules } from '../electronNativeSuite'
import { createMinimalState } from '../controlSurface/controlSurfaceHttpServer.sessionStreaming.testUtils'
import type { TilingLayoutCommitted } from '../../../src/shared/tiling/TilingLayoutStore'
import {
  listTilingWindowIds,
  type TilingLayout,
  type TilingNode,
  type TilingSplit,
} from '../../../src/shared/tiling/tilingLayout'
import { DB_SCHEMA_VERSION } from '../../../src/platform/persistence/sqlite/constants'
import { createPersistenceStore } from '../../../src/platform/persistence/sqlite/PersistenceStore'

type State = {
  workspaces: Array<{
    nodes: unknown[]
    spaces: Array<{ id: string; name: string; nodeIds: string[] }>
  }>
}

function node(id: string, x: number) {
  return {
    id,
    kind: 'terminal',
    sessionId: null,
    title: id,
    position: { x, y: 0 },
    width: 400,
    height: 300,
    labelColorOverride: null,
    status: null,
    startedAt: null,
    endedAt: null,
    exitCode: null,
    lastError: null,
    agent: null,
    task: null,
    scrollback: null,
  }
}

async function fixture(windowIds: string[] = ['a', 'b']) {
  const root = await mkdtemp(join(tmpdir(), 'opencove-tiling-'))
  const dbPath = join(root, 'opencove.db')
  const store = await createPersistenceStore({ dbPath })
  const state = createMinimalState(root, 'project', 'space') as unknown as State
  const setWindows = (ids: string[]) => {
    state.workspaces[0].nodes = ids.map((id, index) => node(id, index * 500))
    state.workspaces[0].spaces[0].nodeIds = ids
  }
  setWindows(windowIds)
  const events: Array<TilingLayoutCommitted | 'app_state'> = []
  const observe = (target: typeof store) => {
    target.onAppStateCommitted!(() => events.push('app_state'))
    target.tilingLayouts!.onCommitted(event => events.push(event))
  }
  observe(store)
  const write = async () => {
    expect(await store.writeAppState(state)).toMatchObject({ ok: true })
  }
  await write()
  events.length = 0
  return {
    dbPath,
    store,
    layouts: store.tilingLayouts!,
    state,
    setWindows,
    write,
    events,
    tilingEvents: () => events.filter(event => event !== 'app_state'),
    cleanup: async () => {
      store.dispose()
      await rm(root, { recursive: true, force: true })
    },
  }
}

const rootSplit = (layout: TilingLayout): TilingSplit => {
  expect(layout.root?.kind).toBe('split')
  return layout.root as TilingSplit
}

let operation = 0
const nextOperationId = () => `op-${++operation}`

describeWithElectronNativeModules('tiling layout storage', () => {
  it('derives the first layout once and returns the same ids afterwards', async () => {
    const f = await fixture()
    try {
      const first = await f.layouts.read('space')
      expect(first?.layoutRevision).toBe(1)
      expect(listTilingWindowIds(first!.layout.root)).toEqual(['a', 'b'])
      expect(rootSplit(first!.layout).direction).toBe('row')
      expect(await f.layouts.read('space')).toEqual(first)
      expect(f.events).toEqual([
        { revision: 1, spaceId: 'space', layoutRevision: 1, operationId: null },
      ])
      expect(await f.layouts.read('missing')).toBeNull()
      expect(
        await f.layouts.apply({
          spaceId: 'missing',
          operationId: nextOperationId(),
          command: { kind: 'resetLayout' },
        }),
      ).toBeNull()
    } finally {
      await f.cleanup()
    }
  })

  it('gives two clients that read first at the same time one layout and one row', async () => {
    const f = await fixture()
    const second = await createPersistenceStore({ dbPath: f.dbPath })
    try {
      const [one, two] = await Promise.all([
        f.layouts.read('space'),
        second.tilingLayouts!.read('space'),
      ])
      expect(one?.layoutRevision).toBe(1)
      expect(two).toEqual(one)
      const inspect = new Database(f.dbPath, { readonly: true })
      try {
        expect(
          inspect.prepare('SELECT space_id FROM workspace_space_tiling_layouts').all(),
        ).toEqual([{ space_id: 'space' }])
      } finally {
        inspect.close()
      }
    } finally {
      second.dispose()
      await f.cleanup()
    }
  })

  it('keeps layout and revision when an older client writes a snapshot that renames the Space', async () => {
    const f = await fixture()
    try {
      const before = await f.layouts.read('space')
      f.events.length = 0
      f.state.workspaces[0].spaces[0].name = 'Renamed by a client without tiling'
      await f.write()
      expect(f.events).toEqual(['app_state'])
      expect(await f.layouts.read('space')).toEqual(before)
      expect(f.tilingEvents()).toEqual([])
    } finally {
      await f.cleanup()
    }
  })

  it('normalises the layout in the snapshot write that changes the windows of a Space', async () => {
    const f = await fixture()
    try {
      const before = await f.layouts.read('space')
      f.events.length = 0
      f.setWindows(['a', 'b', 'c'])
      await f.write()
      f.setWindows(['a', 'c'])
      await f.write()
      // The app state event of a write comes first; the layout event carries its revision.
      expect(f.events).toEqual([
        'app_state',
        { revision: 2, spaceId: 'space', layoutRevision: 2, operationId: null },
        'app_state',
        { revision: 3, spaceId: 'space', layoutRevision: 3, operationId: null },
      ])
      const after = await f.layouts.read('space')
      expect(after?.layoutRevision).toBe(3)
      expect([...listTilingWindowIds(after!.layout.root)].sort()).toEqual(['a', 'c'])
      expect(rootSplit(after!.layout).id).toBe(rootSplit(before!.layout).id)
    } finally {
      await f.cleanup()
    }
  })

  it('stores an empty layout and counts the first window and each close', async () => {
    const f = await fixture([])
    try {
      expect(await f.layouts.read('space')).toEqual({
        layout: { version: 1, root: null },
        layoutRevision: 1,
      })
      f.setWindows(['a'])
      await f.write()
      expect((await f.layouts.read('space'))?.layout.root).toMatchObject({
        kind: 'group',
        nodeIds: ['a'],
      })
      f.setWindows([])
      await f.write()
      expect(await f.layouts.read('space')).toEqual({
        layout: { version: 1, root: null },
        layoutRevision: 3,
      })
      expect(f.tilingEvents().map(event => event.layoutRevision)).toEqual([1, 2, 3])
    } finally {
      await f.cleanup()
    }
  })

  it('deletes the layout with its Space', async () => {
    const f = await fixture()
    try {
      await f.layouts.read('space')
      f.events.length = 0
      f.state.workspaces[0].spaces = []
      await f.write()
      expect(await f.layouts.read('space')).toBeNull()
      expect(f.tilingEvents()).toEqual([])
      const inspect = new Database(f.dbPath, { readonly: true })
      try {
        expect(inspect.prepare('SELECT * FROM workspace_space_tiling_layouts').all()).toEqual([])
      } finally {
        inspect.close()
      }
    } finally {
      await f.cleanup()
    }
  })

  it('applies interleaved commands and rejects one whose target is gone', async () => {
    const f = await fixture(['a', 'b', 'c'])
    try {
      // Both clients start from revision 1.
      const seen = (await f.layouts.read('space'))!
      // Three windows derive to a column of the row [a | b] above the group of c.
      const column = rootSplit(seen.layout)
      const [row, groupC] = column.children as [TilingSplit, TilingNode]
      const [groupA, groupB] = row.children
      f.events.length = 0

      const first = await f.layouts.apply({
        spaceId: 'space',
        operationId: 'client-1',
        command: {
          kind: 'setWeights',
          splitId: row.id,
          between: [groupA.id, groupB.id],
          weights: [3, 1],
        },
      })
      expect(first).toMatchObject({ kind: 'applied', changed: true, layoutRevision: 2 })
      // The second client still names revision 1; its command touches another place and applies.
      const second = await f.layouts.apply({
        spaceId: 'space',
        operationId: 'client-2',
        command: { kind: 'moveWindow', nodeId: 'c', toGroupId: groupB.id },
      })
      expect(second).toMatchObject({ kind: 'applied', changed: true, layoutRevision: 3 })
      // The group of `c` is gone now: a divider drag against it is stale, not a silent overwrite.
      const stale = await f.layouts.apply({
        spaceId: 'space',
        operationId: 'client-1b',
        command: {
          kind: 'setWeights',
          splitId: column.id,
          between: [row.id, groupC.id],
          weights: [1, 1],
        },
      })
      expect(stale).toMatchObject({ kind: 'rejected_stale_target', layoutRevision: 3 })
      expect(stale).toMatchObject({ layout: (await f.layouts.read('space'))!.layout })
      expect(f.events).toEqual([
        { revision: 1, spaceId: 'space', layoutRevision: 2, operationId: 'client-1' },
        { revision: 1, spaceId: 'space', layoutRevision: 3, operationId: 'client-2' },
      ])
    } finally {
      await f.cleanup()
    }
  })

  it('announces a reset, and nothing for a command that changes nothing or cannot apply', async () => {
    const f = await fixture()
    try {
      const seen = (await f.layouts.read('space'))!
      const split = rootSplit(seen.layout)
      f.events.length = 0
      expect(
        await f.layouts.apply({
          spaceId: 'space',
          operationId: nextOperationId(),
          command: { kind: 'equalise', splitId: split.id },
        }),
      ).toEqual({ kind: 'applied', changed: false, ...seen })
      expect(
        await f.layouts.apply({
          spaceId: 'space',
          operationId: nextOperationId(),
          command: {
            kind: 'setWeights',
            splitId: split.id,
            between: [split.children[0].id, split.children[1].id],
            weights: [0, -1],
          },
        }),
      ).toMatchObject({ kind: 'rejected_invalid_command' })
      expect(f.events).toEqual([])

      const reset = await f.layouts.apply({
        spaceId: 'space',
        operationId: 'reset-1',
        command: { kind: 'resetLayout' },
      })
      expect(reset).toMatchObject({ kind: 'applied', changed: true, layoutRevision: 2 })
      expect(reset?.kind === 'applied' && rootSplit(reset.layout).id).not.toBe(split.id)
      expect(f.events).toEqual([
        { revision: 1, spaceId: 'space', layoutRevision: 2, operationId: 'reset-1' },
      ])
    } finally {
      await f.cleanup()
    }
  })

  it('stores the first layout when a command arrives before any read', async () => {
    const f = await fixture()
    try {
      const result = await f.layouts.apply({
        spaceId: 'space',
        operationId: 'early',
        command: { kind: 'equalise', splitId: 'unknown-split' },
      })
      expect(result).toMatchObject({ kind: 'rejected_stale_target', layoutRevision: 1 })
      expect(await f.layouts.read('space')).toMatchObject({
        layout: result?.kind === 'rejected_stale_target' ? result.layout : null,
        layoutRevision: 1,
      })
      expect(f.events).toEqual([
        { revision: 1, spaceId: 'space', layoutRevision: 1, operationId: null },
      ])
    } finally {
      await f.cleanup()
    }
  })

  it('repairs a layout whose windows a Worker without tiling left behind', async () => {
    const f = await fixture()
    try {
      const seen = (await f.layouts.read('space'))!
      f.events.length = 0
      const sql = new Database(f.dbPath)
      try {
        // What a snapshot write of an older Worker does: the Space changes, the layout row stays.
        sql.prepare("DELETE FROM workspace_space_nodes WHERE node_id = 'b'").run()
      } finally {
        sql.close()
      }
      const repaired = await f.layouts.read('space')
      expect(repaired?.layoutRevision).toBe(seen.layoutRevision + 1)
      expect(listTilingWindowIds(repaired!.layout.root)).toEqual(['a'])
      expect(f.events).toEqual([
        { revision: 1, spaceId: 'space', layoutRevision: 2, operationId: null },
      ])
    } finally {
      await f.cleanup()
    }
  })

  it.each([15, DB_SCHEMA_VERSION])(
    'creates the table when a version %i profile lacks it',
    async version => {
      const f = await fixture()
      try {
        f.store.dispose()
        const sql = new Database(f.dbPath)
        try {
          sql.exec(`DROP TABLE workspace_space_tiling_layouts; PRAGMA user_version = ${version}`)
        } finally {
          sql.close()
        }
        const reopened = await createPersistenceStore({ dbPath: f.dbPath })
        try {
          expect((await reopened.tilingLayouts!.read('space'))?.layoutRevision).toBe(1)
          const inspect = new Database(f.dbPath, { readonly: true })
          try {
            expect(inspect.pragma('user_version', { simple: true })).toBe(DB_SCHEMA_VERSION)
            expect(inspect.pragma('foreign_key_list(workspace_space_tiling_layouts)')).toEqual([])
          } finally {
            inspect.close()
          }
        } finally {
          reopened.dispose()
        }
      } finally {
        await f.cleanup()
      }
    },
  )
})
