import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type {
  StoredTilingLayout,
  TilingLayoutCommitted,
  TilingLayoutStore,
  TilingStoreCommandResult,
} from '../../../shared/tiling/TilingLayoutStore'
import {
  TILING_LAYOUT_VERSION,
  listTilingWindowIds,
  type TilingLayout,
} from '../../../shared/tiling/tilingLayout'
import { applyTilingCommand } from '../../../shared/tiling/tilingLayoutCommands'
import { deriveInitialTilingLayout } from '../../../shared/tiling/tilingLayoutDerive'
import { normalizeTilingLayout } from '../../../shared/tiling/tilingLayoutNormalize'

/** Additive and idempotent; no foreign keys, because snapshot writes replace the Space rows. */
export function ensureTilingLayoutSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS workspace_space_tiling_layouts (
      space_id TEXT PRIMARY KEY NOT NULL,
      layout_json TEXT NOT NULL,
      layout_revision INTEGER NOT NULL CHECK (typeof(layout_revision) = 'integer' AND layout_revision >= 1)
    );
  `)
}

export type TilingLayoutChange = Pick<TilingLayoutCommitted, 'spaceId' | 'layoutRevision'>

function parseLayout(raw: string): TilingLayout | null {
  try {
    const parsed = JSON.parse(raw) as { version?: unknown; root?: unknown } | null
    if (
      parsed &&
      parsed.version === TILING_LAYOUT_VERSION &&
      (parsed.root === null || (typeof parsed.root === 'object' && !Array.isArray(parsed.root)))
    ) {
      return parsed as TilingLayout
    }
  } catch {
    // An unreadable row is rebuilt from the Space's windows.
  }
  return null
}

function readRow(db: Database.Database, spaceId: string) {
  const row = db
    .prepare(
      'SELECT layout_json AS json, layout_revision AS layoutRevision FROM workspace_space_tiling_layouts WHERE space_id = ?',
    )
    .get(spaceId) as { json: string; layoutRevision: number } | undefined
  return row ? { layout: parseLayout(row.json), layoutRevision: row.layoutRevision } : null
}

function writeRow(db: Database.Database, spaceId: string, stored: StoredTilingLayout): void {
  db.prepare(
    `INSERT INTO workspace_space_tiling_layouts (space_id, layout_json, layout_revision)
     VALUES (?, ?, ?)
     ON CONFLICT(space_id) DO UPDATE SET
       layout_json = excluded.layout_json,
       layout_revision = excluded.layout_revision`,
  ).run(spaceId, JSON.stringify(stored.layout), stored.layoutRevision)
}

function spaceExists(db: Database.Database, spaceId: string): boolean {
  return !!db.prepare('SELECT 1 FROM workspace_spaces WHERE id = ? LIMIT 1').get(spaceId)
}

function readSpaceNodeIds(db: Database.Database, spaceId: string): string[] {
  const rows = db
    .prepare(
      'SELECT node_id AS id FROM workspace_space_nodes WHERE space_id = ? ORDER BY sort_order',
    )
    .all(spaceId) as { id: string }[]
  return rows.map(row => row.id)
}

function deriveFromCanvas(db: Database.Database, spaceId: string): TilingLayout {
  const windows = db
    .prepare(
      `SELECT members.node_id AS id,
              COALESCE(nodes.position_x, 0) AS x,
              COALESCE(nodes.position_y, 0) AS y
       FROM workspace_space_nodes AS members
       LEFT JOIN nodes ON nodes.id = members.node_id
       WHERE members.space_id = ?
       ORDER BY members.sort_order`,
    )
    .all(spaceId) as { id: string; x: number; y: number }[]
  return deriveInitialTilingLayout(windows, randomUUID)
}

function sameMembers(layout: TilingLayout, nodeIds: readonly string[]): boolean {
  const placed = listTilingWindowIds(layout.root)
  const members = new Set(nodeIds)
  return placed.length === members.size && placed.every(id => members.has(id))
}

/**
 * Runs inside the snapshot writer's transaction, after the Space rows were replaced (spec §3.1,
 * §3.3): drops the layouts of Spaces that are gone, and normalises the layout of every Space
 * whose windows changed. Returns what changed, for the caller to announce after its commit.
 */
export function reconcileTilingLayoutsWithSpaces(db: Database.Database): TilingLayoutChange[] {
  db.exec(
    'DELETE FROM workspace_space_tiling_layouts WHERE space_id NOT IN (SELECT id FROM workspace_spaces)',
  )
  const rows = db
    .prepare(
      'SELECT space_id AS spaceId, layout_json AS json, layout_revision AS layoutRevision FROM workspace_space_tiling_layouts',
    )
    .all() as { spaceId: string; json: string; layoutRevision: number }[]
  const changes: TilingLayoutChange[] = []
  for (const row of rows) {
    const layout = parseLayout(row.json)
    const nodeIds = readSpaceNodeIds(db, row.spaceId)
    if (layout && sameMembers(layout, nodeIds)) {
      continue
    }
    const next = normalizeTilingLayout(layout, nodeIds, randomUUID)
    const layoutRevision = row.layoutRevision + 1
    writeRow(db, row.spaceId, { layout: next, layoutRevision })
    changes.push({ spaceId: row.spaceId, layoutRevision })
  }
  return changes
}

/** No await inside the transactions; listeners are told only after a commit. */
export function createSqliteTilingLayoutStore(
  db: Database.Database,
  readAppStateRevision: () => number,
): TilingLayoutStore & { publish(event: TilingLayoutCommitted): void } {
  const listeners = new Set<(event: TilingLayoutCommitted) => void>()
  const publish = (event: TilingLayoutCommitted): void => {
    for (const listener of listeners) {
      try {
        listener(event)
      } catch {
        /* Observers cannot change an already committed result. */
      }
    }
  }
  const committed = (spaceId: string, layoutRevision: number, operationId: string | null) => ({
    revision: readAppStateRevision(),
    spaceId,
    layoutRevision,
    operationId,
  })

  /**
   * The layout to work on. `saved` is false while it differs from the row: no row yet (the first
   * layout is derived), or a row whose windows no longer match the Space, as a Worker without
   * tiling leaves it after a snapshot write (normalised here, like on a snapshot write).
   */
  const current = (spaceId: string): StoredTilingLayout & { saved: boolean } => {
    const row = readRow(db, spaceId)
    const nodeIds = readSpaceNodeIds(db, spaceId)
    if (row?.layout && sameMembers(row.layout, nodeIds)) {
      return { layout: row.layout, layoutRevision: row.layoutRevision, saved: true }
    }
    return {
      layout: row?.layout
        ? normalizeTilingLayout(row.layout, nodeIds, randomUUID)
        : deriveFromCanvas(db, spaceId),
      layoutRevision: row?.layoutRevision ?? 0,
      saved: false,
    }
  }
  const store = (spaceId: string, layout: TilingLayout, previousRevision: number) => {
    const stored = { layout, layoutRevision: previousRevision + 1 }
    writeRow(db, spaceId, stored)
    return stored
  }

  return {
    publish,
    onCommitted: listener => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    read: async spaceId => {
      const { result, event } = db
        .transaction(() => {
          if (!spaceExists(db, spaceId)) {
            return { result: null, event: null }
          }
          const { saved, ...base } = current(spaceId)
          if (saved) {
            return { result: base, event: null }
          }
          const stored = store(spaceId, base.layout, base.layoutRevision)
          return { result: stored, event: committed(spaceId, stored.layoutRevision, null) }
        })
        .immediate()
      if (event) {
        publish(event)
      }
      return result
    },
    apply: async ({ spaceId, operationId, command }) => {
      const { result, event } = db
        .transaction(
          (): {
            result: TilingStoreCommandResult | null
            event: TilingLayoutCommitted | null
          } => {
            if (!spaceExists(db, spaceId)) {
              return { result: null, event: null }
            }
            if (command.kind === 'resetLayout') {
              const previous = readRow(db, spaceId)?.layoutRevision ?? 0
              const stored = store(spaceId, deriveFromCanvas(db, spaceId), previous)
              return {
                result: { kind: 'applied', changed: true, ...stored },
                event: committed(spaceId, stored.layoutRevision, operationId),
              }
            }
            const { saved, ...base } = current(spaceId)
            const applied = applyTilingCommand(base.layout, command, {
              nodeIds: readSpaceNodeIds(db, spaceId),
              createId: randomUUID,
            })
            if (applied.kind === 'applied' && applied.changed) {
              const stored = store(spaceId, applied.layout, base.layoutRevision)
              return {
                result: { kind: 'applied', changed: true, ...stored },
                event: committed(spaceId, stored.layoutRevision, operationId),
              }
            }
            // The command changed nothing. A layout that was only derived or normalised for it is
            // stored all the same, so the ids in the answer are the ones every later read returns.
            const stored = saved ? base : store(spaceId, base.layout, base.layoutRevision)
            const repaired = saved ? null : committed(spaceId, stored.layoutRevision, null)
            if (applied.kind === 'rejected_invalid_command') {
              return { result: applied, event: repaired }
            }
            return {
              result:
                applied.kind === 'applied'
                  ? { kind: 'applied', changed: false, ...stored }
                  : { kind: 'rejected_stale_target', reason: applied.reason, ...stored },
              event: repaired,
            }
          },
        )
        .immediate()
      if (event) {
        publish(event)
      }
      return result
    },
  }
}
