# Tiling View Spec

This spec defines a second way to look at a Space: a **tiling view** that arranges the Space's windows as non-overlapping tiles filling the screen, driven mostly by the keyboard. The canvas stays the default and stays untouched.

Status: Proposed (Large change), revision 5: feasibility check done (§10.1), model details settled while building slice 1. Awaiting approval of this spec, then a feasibility check (section 10), then a plan. Nothing here is implemented yet.

## Problem Class

This is a mature problem: tiling window management. Terminal multiplexers, tiling window managers and editors have solved arranging many live panes on one screen, and their users have strong habits (split, focus by direction, maximise, tab). The local constraints are the Session Desk ones: windows are React Flow nodes on an infinite canvas, terminals are clients of Worker-owned PTY sessions with one controller per session, several clients (Desktop and Web, possibly of different versions) can show the same workspace at once, and the workspace document is saved as full snapshots.

## External References

- [i3 user's guide: tree](https://i3wm.org/docs/userguide.html#_tree): the layout is a tree of containers; each container splits horizontally or vertically or stacks its children as tabs, and leaves are windows. Focus moves by direction, and a new window opens next to the focused one.
- [sway](https://swaywm.org/): the same tree model on Wayland; shows the model survives a different rendering stack.
- [tmux](https://man.openbsd.org/tmux.1): panes in windows, a prefix key for commands, zoom (`resize-pane -Z`) to maximise one pane and restore the layout, and a pane's process outliving any client's view of it.
- [GNU Emacs: Windows](https://www.gnu.org/software/emacs/manual/html_node/emacs/Windows.html): splitting the selected window, `other-window`, and window configurations kept apart from the buffers they show.
- [VS Code editor groups](https://code.visualstudio.com/docs/getstarted/userinterface#_editor-groups): a grid of groups, each a tab stack; splitting moves the active editor into a new group; empty groups close.
- [Zellij layouts](https://zellij.dev/documentation/layouts): declarative pane layouts and a status bar that teaches the current mode's keys.
- [DreamCoder](https://www.masteringemacs.org/article/announcing-dreamcoder): panes with minimum, comfortable and maximum sizes laid out by a constraint solver, overflow panes moved to a hidden bar, workspaces as virtual desktops, and a per-workspace status minimap. Only the ideas are borrowed, not the look.

What transfers:

- **A tree of splits with tab groups as leaves** (i3, VS Code). It is easy to reason about, to test and to serialise; every layout people use daily is expressible in it.
- **The layout is separate from what it shows** (Emacs, tmux). Leaving the tiling view never ends a process. Closing a tile is closing its window, with the canvas's existing close semantics (section 1.3).
- **Tabs, not a hidden bar, for overflow.** A tab group shows that more windows are there and how to reach them; a hidden bar needs a second place to look. DreamCoder's constraint solver is set aside for now: minimum sizes plus tabs cover the same need with a model a person can predict.
- **Zoom** (tmux): maximise one tile and restore the layout exactly.
- **A visible mode hint** (Zellij) while a prefix is armed, so the keys are discoverable.

## 1. Business Logic

### 1.1 View mode and tiling target

- A client window shows either the **Canvas** (today) or the **Tiling** view. The choice is per client window and not synced: switching one browser tab or Desktop window to Tiling changes nothing for other windows or other people looking at the same workspace.
- In Tiling, the client shows one Space at a time, its **tiling target**. The tiling target is client-local and separate from the workspace's `activeSpaceId`, which only accepts root Spaces and stays as it is. The tiling target may be a root Space or a child Space.
- Reaching a Space in Tiling:
  - choosing a Space in the sidebar's Space tree, root or child, makes it the tiling target;
  - the tiling header shows the target's path (breadcrumb, root first) and its child Spaces; choosing one makes it the target;
  - keyboard: go to parent, go to first child, next/previous sibling (section 1.5).
- A child Space has its own layout. Its windows do not appear in its parent's tiles; the parent's header lists the child so its windows are always one step away.
- A per-client default can be set in settings: Canvas (default) or Tiling. The last view mode and tiling target are remembered per client.

### 1.2 Layout

- A Space's layout is a tree:
  - a **split** has a direction (row or column), two or more children and a weight per child;
  - a **group** is a leaf: an ordered list of windows shown as tabs, with one active window.
- Every split and group has a **stable id** (generated, unique within the layout). Commands address splits and groups by id, never by path (section 3).
- Every window of the Space is in exactly one group. A group with one window shows no tab strip, only the window's own header.
- The layout is **shared**: it belongs to the Space, is stored by the Worker and survives restarts, so every client in Tiling on that Space sees the same arrangement. Canvas positions and sizes are never changed by the tiling view, and the layout is never changed by moving windows on the canvas.
- **The first layout is the Worker's**, not a client's. When a client opens a Space in Tiling and the Worker has no layout for it, the Worker derives one, stores it and returns it, in one insert-if-absent transaction. Two clients opening the same Space at once therefore get the same tree with the same ids, whatever their viewports.
- The derivation is deterministic and viewport-independent: windows sorted in reading order (rows by top edge, then left edge, then node id); a row-major grid of `ceil(√n)` columns, each cell a group of one window. Each client then **projects** this tree onto its own viewport locally (fold-for-display and scroll, section 1.4), which never changes the stored tree. A narrow client sees the same groups folded into tabs; widening its window unfolds them.

### 1.3 Windows coming and going

- **A new window created through the tiling view** opens next to the focused tile: the create command names the focused group's id. It splits that group along its longer side if both halves keep their minimum size, otherwise it becomes a new tab in that group and is activated. If the group no longer exists when the Worker applies the command, the window goes to the default destination below.
- **A window that arrives any other way** (created on the canvas, by an Agent, by restore, moved in from another Space, or by a client that does not know tiling) goes to the layout's **default destination**: appended as an inactive tab to the last group in depth-first order (the bottom-right group). This is the same rule the normaliser uses, so every client and the Worker agree on where it lands.
- **A window that leaves** the Space (closed, moved, archived) leaves its group; an empty group is removed and its split's weights are renormalised; a split with one child collapses into that child. When the last window leaves, the layout becomes **empty** (section 4).
- **An empty Space** (no windows, or the last one just closed) shows the empty state: the breadcrumb and child Space list stay, and the tiling area offers to open a terminal or an Agent. The first window to arrive, by any route, becomes the root group.
- **Closing a tile** is `Close Window` on its active window, with the existing close semantics, including save confirmation for unsaved documents. There is no "hidden but open" state.

### 1.4 Sizes

- Every window kind has a **minimum tile size** in CSS pixels; for terminals it is derived from 40 columns by 8 rows at the current font.
- Dragging a divider changes the weights of the two neighbours, clamped so neither drops below its minimum.
- When the screen shrinks so a split can no longer hold its children at minimum size, the view **folds** the smallest child into its neighbour as tabs, for display only. The stored layout is unchanged, so growing the screen again restores it.
- **When even one tile cannot fit** (a narrow Web viewport, a large terminal font), folding has reached a single group and the tiling host **scrolls**: the group keeps its minimum size and the host shows scrollbars on the axis that does not fit. Keyboard focus moves scroll the focused tile and its tab strip into view; every tab stays reachable by keyboard. No tile is ever shrunk below its minimum or cut off without a way to scroll to it.
- **Zoom** shows the focused tile alone over the whole view; zoom again restores the layout. Zoom is per client and not stored.

### 1.5 Keyboard

The tiling view is usable without a pointer. Commands are bound under a **prefix**, configurable alongside the existing canvas commands. The proposed default is `Ctrl+Shift+Space`: `Alt+Space` opens the window's system menu on Windows, `Ctrl+Space` switches input sources on macOS and is set-mark in Emacs, and `Ctrl+B` (tmux) is readline's back-char. `Ctrl+Shift+Space` is not passed to terminal programs as anything distinct from `Ctrl+Space`; its known collision is Monaco's parameter-hints shortcut in document windows, which the prefix overrides while it is bound there. After the prefix a hint line lists the keys until a key is pressed or `Escape`:

| Key after prefix | Command |
| --- | --- |
| Arrow keys / `h j k l` | Focus the tile in that direction |
| `Shift` + arrow / `H J K L` | Move the focused window to the tile in that direction (creating a split at the edge) |
| `s` / `v` | Split the focused group: below / to the right (the active window moves into the new group if the group has several, otherwise a new terminal opens there) |
| `t` | Toggle the focused split between splits and one tab group |
| `[` / `]` | Previous / next tab in the focused group |
| `z` | Zoom / unzoom the focused tile |
| `=` | Equalise the weights of the focused split |
| `1`–`9` | Focus the nth tile in reading order |
| `u` / `d` | Go to the parent Space / the first child Space |
| `n` / `p` | Go to the next / previous sibling Space |
| `x` | Close the focused window (existing close semantics) |
| `c` | Switch this client window back to the Canvas |

**Focus.** Exactly one tile has focus. The client remembers the last focused window per Space (client-local, section 2). When the view opens or reloads, it focuses that window's group if the window is still in the Space; if not, or if nothing is remembered, it focuses the group containing the first window in reading order of the layout (depth-first, the same order as `1`–`9`). Focusing on reload never changes the shared active tab.

The application shortcuts of `docs/ui/APPLICATION_SHORTCUTS.md` keep working unchanged. Key choices respect what browsers do not let a page intercept; the Web UI and Desktop share one map.

### 1.6 Attention and status

- Each tile header and tab shows the window's Agent signal (working, waiting, done, failed) with the same tokens as the sidebar minimap, so a waiting Agent in a background tab is still visible.
- The sidebar minimap keeps drawing the canvas geometry in v1, whatever the view.

### 1.7 Terminals across clients

The Worker's terminal authority is unchanged (`docs/terminal/MULTI_CLIENT_ARCHITECTURE.md`): one controller per session; only the controller may resize the PTY; an accepted resize commits canonical geometry and broadcasts it to every viewer, whichever view that viewer is in.

- When a terminal mounts in a tile, or a divider drag that changes its tile ends, the client measures the tile. If it is the **controller** and the measured size differs from canonical geometry, it sends **at most one** resize (`frame_commit`) for that mount or that release. Nothing is sent while dragging.
- If the client is a **viewer**, it sends no resize and shows the canonical geometry inside its tile with the existing viewer presentation, the same as a viewer on the canvas today.
- Consequently a controller in Tiling can change what a Canvas viewer of the same session sees (its rows and columns), exactly as a controller resizing a canvas window can today. Tiling adds no new geometry authority.

### 1.8 Acceptance criteria

1. Switching a client window with a running Agent terminal between Canvas and Tiling, ten times, keeps the same PTY session id, never has two mounted bodies (renderer subscribers) for that window in that client, keeps scrollback, and keeps the Agent's status. The Worker sees no attach or detach for a view switch: its attachment belongs to the client's runtime coordinator, not to a mounted window (§10.1).
2. The canvas positions and sizes of every window are byte-identical before and after any sequence of tiling commands.
3. Two clients in Tiling on one Space see the same layout after either changes it; a third client on the Canvas sees no layout change.
4. **An older client that does not know tiling saves an unrelated edit** (renames the Space) after a newer client created a layout: the layout is still there afterwards, unchanged.
5. A divider drag released after another client removed or reordered one of its neighbours changes no other tile: the command is rejected and the dragging client shows the current layout.
6. Every window of the Space, and every child Space, is reachable in Tiling by pointer and by keyboard alone, at a viewport of 320 by 480 CSS pixels with the largest terminal font setting.
7. No tile is drawn below its minimum size or overlapping another; shrinking and restoring the viewport restores the stored layout exactly.
8. Per terminal, per mount or divider release: at most one accepted resize, sent only by the controller; a viewer sends none. The controller measures after the tile's first layout, so it sends one request, not a superseded one followed by the accepted one (§10.1).
12. Switching back to the Canvas restores the canvas viewport (pan and zoom) exactly.
13. A native website view in a tile is shown in the tile's content area, clipped to the tiling host, never over other tiles or the sidebar.
9. Reload in Tiling restores the same tiling target and the layout at its latest revision, and focuses the group containing the last focused window if that window is still in the Space; otherwise the fallback focus (section 1.5). The group shows its shared active tab, which may be a different window if another client changed it meanwhile.
10. A wide and a narrow client opening the same Space in Tiling before either edits it receive the same layout revision and the same split and group ids; the narrow one shows it folded.
11. After a layout-only command or `resetLayout` from one client, and after a window is added or removed on the Canvas by another, a passive client in Tiling on that Space shows the new layout without user action.

## 2. State Owners and Invariants

| State | Owner | Persisted / synced |
| --- | --- | --- |
| View mode, tiling target, last focused window per Space | Renderer, per client | Client-local UI preferences |
| Zoom, fold-for-display, prefix armed, divider drag in progress, the layout as last received | Renderer, per client (canvas store slice `tiling`) | Runtime only |
| Layout of a Space (splits, groups, ids, weights, tab order, active tab) and its `layoutRevision` | Worker | Own table `workspace_space_tiling_layouts` (Space id, layout JSON, revision); written only by tiling operations (section 3), never by `sync.writeState` |
| Window membership of a Space | Unchanged: `space.nodeIds` | Unchanged |
| Terminal session, screen, controller role, canonical geometry | Unchanged: Worker / `PtyStreamHub` | Unchanged |

Invariants:

1. **Membership:** the windows in a stored layout equal `space.nodeIds` after every committed transaction. The Worker normalises with one pure function after every tiling command and in the same transaction as every snapshot write that changes membership (section 3.3); a client applies the same function to what it holds until the Worker's update arrives.
2. **Separation:** no tiling operation writes canvas geometry. A snapshot write (`sync.writeState`) never takes a layout from a client; its only effect on a layout is the Worker's own membership normalisation in the same transaction (section 3.3). A layout is deleted only when its Space is deleted or archived, or by `resetLayout`.
3. **One client view per window:** in one client, a window's body is mounted in one host at a time, so a terminal has at most one live attachment per window per client.

## 3. Persistence and Concurrency

### 3.1 Storage apart from the snapshot

`sync.writeState` sends the full workspace snapshot and the SQLite writer replaces the Space rows. If the layout were a Space field, an older client could read the latest revision, rename a Space and save a valid snapshot without the layout, erasing it. So the layout is **not part of the snapshot**:

- it lives in its own table keyed by Space id, with a per-Space `layoutRevision`;
- it is read with `space.readTilingLayout` (which materialises the first layout, section 1.2) and changed only with `space.applyTilingCommand`, the same pattern scrollback already follows (`sync.readNodeScrollback` / `sync.writeNodeScrollback`);
- snapshot writes never carry it. Omission cannot be mistaken for a reset, because the snapshot carries no layout field at all. An explicit reset is its own command (`resetLayout`): the Worker replaces the layout with a freshly derived one (section 1.2), with new ids and the next revision.
- When a snapshot write removes a Space, the Worker deletes that Space's layout in the same transaction.

### 3.2 Commands, not tree writes

Clients never write a tree. They send one command at a time:

```ts
type TilingCommand =
  | { kind: 'setWeights'; splitId: string; between: [string, string]; weights: [number, number] }
  | { kind: 'split'; groupId: string; direction: 'row' | 'column'; nodeId: string }
  | { kind: 'moveWindow'; nodeId: string; toGroupId: string; index?: number }
  | { kind: 'moveToEdge'; nodeId: string; targetId: string; edge: 'top' | 'right' | 'bottom' | 'left' }
  | { kind: 'activate'; groupId: string; nodeId: string }
  | { kind: 'toggleTabs'; targetId: string; activeNodeId?: string }
  | { kind: 'equalise'; splitId: string }
  | { kind: 'placeNew'; nodeId: string; nearGroupId: string; placement: 'tab' | 'row' | 'column' }
  | { kind: 'resetLayout' }

type ApplyTilingCommand = {
  spaceId: string
  baseLayoutRevision: number
  operationId: string
  command: TilingCommand
}
```

The Worker applies commands for one Space in order, and **revalidates every target against the current layout**:

- every id the command names must still exist and still have the role the command expects (a split is a split, a group is a group, a window is in the Space);
- `setWeights` additionally requires that `between` are still two adjacent children of `splitId`, in that order; otherwise it is rejected, even if the split itself still exists. A divider drag that started before a concurrent removal or reorder therefore resizes nothing rather than the wrong tile;
- `placeNew` with a vanished group falls back to the default destination (section 1.3) instead of failing;
- other commands with a missing target are rejected.

Notes on the commands, settled in slice 1 (`src/shared/tiling/`):

- `split` always names the window to move into the new group; a group with one window is `rejected_invalid_command`. "Split and open a new terminal there" (`s` / `v` on a one-window group) is two steps: the client creates the window, then sends `placeNew` with the split direction.
- `placeNew` carries the client's `placement` (`tab`, or the direction to split in), because only the client knows its viewport and the minimum sizes (§1.3). The client sends it after the snapshot write that adds the window has committed; before that the Worker does not know the window and the command is stale.
- `toggleTabs` names a split (which becomes one tab group, active tab `activeNodeId` or the first group's) or a group (whose windows become side-by-side groups).
- `resetLayout` is handled by the Worker with the first-layout derivation, not by the command reducer.
- The reducer normalises against the Space's windows before and after each command, so a command always sees windows that just arrived at their default destination.

The result is typed, like the terminal resize results: `applied` (with `changed`, false when a valid command left the layout as it was) and `rejected_stale_target` both carry the Space's current layout and `layoutRevision`; `rejected_invalid_command` is for commands that can never apply (bad weights, nothing to split); `space_not_found` carries neither. `baseLayoutRevision` tells the client whether its optimistic view was based on the latest layout; a command whose targets still validate is applied even if the revision moved on, so unrelated concurrent edits do not reject each other.

**Applying what arrives.** Layouts reach a client three ways: command results, refetches after `tiling.layout_updated`, and the first read. They can arrive in any order. The client keeps, for its tiling target only, the `layoutRevision` it displays, and:

- ignores any layout for a Space that is not its current tiling target (switching target resets the held revision);
- applies a layout only if its `layoutRevision` is greater than or equal to the displayed one; an older one is dropped;
- drops the optimistic state of a command when that command's result arrives, whether or not the result's layout is applied, so a rejected or superseded command visibly snaps back to the newest layout the client holds.

So a delayed result for revision 8 arriving after a refetch for revision 9 leaves revision 9 on screen, and the client never settles on a layout older than one it has shown. Local membership normalisation (section 3.3) is applied on top of the held revision and does not change it.

Divider drags update weights only in the client's interaction slice per frame and send one `setWeights` on release.

### 3.3 How every client learns of a change

Every change to a stored layout increments its `layoutRevision` and, **after the transaction commits**, the Worker emits one event on the existing sync event stream (`SyncEventPayload`, next to `app_state.updated`):

```ts
{ type: 'tiling.layout_updated'; revision: number; spaceId: string; layoutRevision: number; operationId: string | null }
```

The causes are exactly three, each in one transaction with its event:

1. an applied `space.applyTilingCommand` (`operationId` is the command's);
2. `resetLayout` and the first materialisation on read;
3. **membership normalisation:** when a snapshot write changes the `nodeIds` of a Space that has a stored layout, the Worker runs `normalizeTilingLayout` on it in the same transaction, stores the result if it differs, increments `layoutRevision` and emits the event (`operationId` null). So a window added or removed by any client, including one that knows nothing of tiling, moves the layout revision too, and every client gets the same ids for the new window's group.

Notes settled in slice 2 (`SqliteTilingLayoutStore`, `spaceTilingHandlers`):

- The event's `revision` is the app state revision at the time of the commit. A layout change does not move it, so several layout events can carry the same `revision`; clients order layouts by `layoutRevision` only. The stream's replay cursor is the app state revision, so a reconnecting client may miss layout events and refetches, as below.
- A snapshot write that changes membership emits `app_state.updated` first, then `tiling.layout_updated`.
- Membership is compared as a set: reordering `nodeIds` alone changes nothing.
- A command that arrives before any read materialises the first layout too (its own event, `operationId` null), so the ids in a `rejected_stale_target` answer are the stored ones.
- A read or a command that finds a stored layout whose windows no longer match the Space (a Worker without tiling wrote snapshots in between) normalises it like a snapshot write would: next `layoutRevision`, one event, `operationId` null.
- A payload that is not one of the commands (an unknown `kind`, a wrong type) is `common.invalid_input` at the control surface; `rejected_invalid_command` is for well-formed commands that can never apply.
- An agent terminal may call both operations for Spaces and windows of its own workspace (the session grant workspace scope checks `spaceId` and `nodeId`).
- The sync stream is not filtered by workspace, so `tiling.layout_updated` is not delivered to a stream opened with a session grant, neither live nor on replay. An agent reads the layouts it may see with `space.readTilingLayout`.
- Both handlers check that the caller is still active after waiting for the store and before the store's transaction; a read counts, because it can store the first layout.
- `setWeights` scales the two weights before summing them. A ratio that would leave one side a share of zero is `rejected_invalid_command`; the other children of the split never change.

A client in Tiling on a Space refetches that Space's layout when an event names it with a `layoutRevision` higher than the one it holds; events for other Spaces are ignored. On `resync_required` or a reconnect, it refetches the layout of its tiling target unconditionally. Between an `app_state.updated` that changes membership and the matching `tiling.layout_updated`, the client applies `normalizeTilingLayout` locally to what it holds, so it never shows a window twice or misses one; the Worker's event then replaces that local result. No polling.

## 4. Data Model (proposal)

```ts
type TilingLayout = { version: 1; root: TilingNode | null }
type TilingNode =
  | { kind: 'split'; id: string; direction: 'row' | 'column'; children: TilingNode[]; weights: number[] }
  | { kind: 'group'; id: string; nodeIds: string[]; activeNodeId: string }
```

- `weights` has the same length as `children`, entries are positive and sum to 1 (normalised on write).
- Ids are unique within a layout and never reused after removal.
- `root: null` is the **empty layout**, the only valid layout of a Space with no windows. It is stored and versioned like any other: opening an empty Space materialises `{ version: 1, root: null }` at revision 1; the first window arriving makes a new group the root (revision +1); closing the last window returns to `root: null` (revision +1). Ids are never reused across these transitions.
- On an empty layout only `placeNew` and `resetLayout` apply; every other command is `rejected_stale_target`. The default destination (section 1.3) of an empty layout is a new root group.
- Focus in an empty layout rests on the empty state's first action; the remembered window (section 1.5) is kept and used if it returns.
- `normalizeTilingLayout(layout | null, nodeIds) → TilingLayout` is the single place that enforces invariant 1: drops unknown window ids, appends missing ones to the default destination, removes empty groups, collapses single-child splits, returns `root: null` when no window is left, keeps the ids of everything that survives. It is pure and shared by the Worker and the client's optimistic path.

## 5. Rendering

- A new host component, a sibling of the canvas host, renders the tree with CSS grid/flex and plain dividers (no new layout dependency for v1).
- Tiles render the existing window bodies (terminal, Agent, note, document, website) through the same node components the canvas uses, without React Flow's node wrapper; window chrome (title, actions, Agent signal) comes from the shared window header.
- Switching views unmounts a window body in one host and mounts it in the other (invariant 3). The feasibility check confirmed this works (§10.1), so remounting is the design.
- **Providers above both hosts.** Window bodies need contexts that today only the canvas view provides: `TerminalDisplayAlignmentProvider` (throws without it; in the check that took the whole canvas down), and the document navigation and filesystem node contexts (missing silently). They move above both hosts. A test renders each window kind in the tiling host.
- **Native views' clip area.** Native website views are positioned from the window body's DOM rect but clipped to the canvas pane. The tiling host occupies the canvas pane; if it ever covers more, it has to give native views its own clip rect.
- **Fallback, not needed** (kept for the record): window bodies render into keep-alive containers whose DOM parent never changes, one per window, in a layer above both hosts. The canvas and tiling hosts only report slot rectangles; the container is positioned and clipped over the active host's slot, as native website views already are. A portal whose target element changes would make React recreate its content, and moving an iframe's element reloads it, so neither is used.

## 6. Accessibility

- Each tile is a labelled region; tab strips use the ARIA tabs pattern; dividers are focusable separators with arrow-key resizing.
- Focus is always on exactly one tile; moving focus by keyboard moves DOM focus into the tile's content and scrolls it into view (section 1.4).
- The breadcrumb and child Space list are a navigation landmark.
- The prefix hint line is announced politely. Reduced motion disables any tile transition.
- In forced-colours mode the focused tile and the Agent signals have outlines, not only colour or shadow.

## 7. Out of Scope for v1

- Floating windows inside the tiling view.
- A constraint solver for sizes (comfortable/maximum sizes); revisit if folding to tabs proves too coarse.
- Several Spaces tiled side by side.
- Saved named layouts per Space.
- The minimap following the tiling geometry.
- A dedicated phone layout (a narrow viewport shows one scrolling group with tabs, section 1.4).

## 8. Risks

- **Terminal remount.** Correctness comes from Worker snapshot and stream replay, the same path as switching workspace, but switching views makes it a frequent user action. Risks: flicker, lost focus, attachments overlapping during the switch.
- **Native website views on Desktop.** They must follow the tile's rectangle and z-order, and be hidden in background tabs and while scrolled out of view.
- **Hub files.** The canvas code is under an active refactoring plan with mechanical subscriber checks (`DEVELOPMENT.md`, S3–S7). The tiling host is a sibling that uses the same document commands, not new branches in `WorkspaceCanvasInner`.
- **Shortcut collisions** with terminal programs and browser-reserved keys; mitigated by a configurable prefix.
- **Two layouts drifting:** windows created in Tiling still get a canvas position by the existing placement for new windows.

## 9. Verification Plan

- **Unit (pure):** `normalizeTilingLayout` and the command reducer, with property-based tests: for random interleavings of commands and membership changes, invariant 1 holds, ids of surviving nodes are stable, canvas geometry is untouched (invariant 2), and a `setWeights` whose `between` pair is no longer adjacent is always rejected. Fold-for-display and the scroll fallback are pure functions of layout and viewport, tested the same way.
- **Contract (Worker):**
  - acceptance 4: a client writes a layout with `applyTilingCommand`; then a snapshot from an older-client fixture (no tiling knowledge, renames the Space) goes through `sync.writeState`; the layout and its revision are unchanged;
  - deleting a Space through a snapshot deletes its layout in the same transaction;
  - acceptance 5: two clients' interleaved commands, including a stale `setWeights`, give `rejected_stale_target` and leave the layout as the other client's command made it;
  - migration of the new table;
  - empty layouts: opening an empty Space stores `root: null` at revision 1; adding its first window through a snapshot and closing it again each increment the revision and emit one event;
  - acceptance 10: two concurrent first reads of a Space with no layout, one from a wide and one from a narrow client fixture, return the same revision and ids, and only one row is stored;
  - section 3.3: an applied command, a reset, and a snapshot that adds and removes windows each emit exactly one `tiling.layout_updated` after commit with the incremented revision; a snapshot that does not change membership emits none and leaves the revision unchanged.
- **Type:** the layout and command types are the only shapes the operations accept; there is no operation that takes a whole tree from a client.
- **Unit (ordering):** layouts for one Space delivered in reverse order (refetch at revision 9, then the delayed command result at revision 8) leave revision 9 displayed and clear the command's optimistic state; a layout for another Space is ignored.
- **Unit (empty):** normalising with no windows gives `root: null`; `placeNew` on it gives a single root group; removing that window gives `root: null` again with no reused ids; other commands on the empty layout are rejected.
- **Unit (focus):** the reload focus rule for a remembered window still present, removed, moved to another Space, and nothing remembered.
- **E2E (Desktop and Web):** acceptance 11 (a passive client updates after a command, a reset, and a Canvas edit in another client); acceptance 1 (ten switches: same session id, never two mounted bodies for the window, no Worker attach or detach, scrollback present), 3 (two clients), 6 (320 by 480 viewport, largest font, every tab and child Space reached by keyboard), 8 (resize count per mount and per release for a controller and a viewer client), 9 (reload). Added to the E2E budget with reasons.
- **Visual:** screenshots of light, dark and forced-colours themes for the implementation PRs.

## 10. Feasibility Check (before the plan)

A throwaway branch proves the riskiest part only: switch one client window between the canvas and a single full-screen tile showing a running Agent terminal and a website window, with a second client attached to the same terminal as a viewer.

Measure and report:

- the PTY session id before and after ten switches (expected: unchanged);
- the attach/detach sequence for the window in the switching client (expected: strictly alternating, never two live attachments);
- time from switch to first painted terminal frame;
- accepted resizes per switch from the controller (expected: at most one) and none from the viewer, and what the viewer shows;
- whether a Desktop native website view follows the tile and hides correctly.

If remounting is too slow or flickers, the check also prototypes the keep-alive container fallback (section 5) and compares.

### 10.1 Results

Run on Linux in CI, Desktop as controller and a Web client as viewer, ten switches each way, three repeats (draft PR #60, closed):

- Same PTY session id throughout; at most one mounted body per window per client; scrollback back after every switch.
- The Worker saw no attach or detach for any switch.
- Controller: exactly one accepted resize per mount, but also one superseded request per mount. Viewer: no requests; it shows the canonical grid.
- Canvas to tile ready: 0.3–0.6 s on Web, about 1 s on Desktop (mostly the resize round trip). Tile to canvas: 0.4–0.6 s.
- Desktop website view: no reload (same `webContents`, same time origin), lifecycle stays active, bounds follow the tile; clipped to the canvas pane.
- The canvas viewport moved once on the first switch back (a spike artifact of removing and re-adding one node, but worth acceptance 12).

Conclusion: remounting is fine; the keep-alive fallback is not needed.

## 11. Decisions Taken in Review

- Minimap: keeps the canvas geometry in v1.
- Closing a tile: `Close Window` with the existing semantics, including save confirmation.
- Prefix: not `Alt+Space` (Windows system menu); `Ctrl+Shift+Space` proposed, configurable.
- Child Spaces: reachable in Tiling through a client-local tiling target, the breadcrumb and child list, and keyboard commands.
- Layout storage: apart from the snapshot, changed only by revalidated commands and the Worker's own membership normalisation.
- First layout: derived and stored by the Worker, projected per viewport by each client.
- Change notification: a post-commit `tiling.layout_updated` event, no polling.
- Focus on reload: the group of the last focused window per Space, client-local, validated, with a deterministic fallback; the shared active tab is not changed.
- Ordering: a client applies a layout only for its current tiling target and only at a revision no older than the one it shows.
- Empty Spaces: an explicit `root: null` layout, stored and versioned.

## 12. Delivery Slices (sketch, for the plan)

1. and 2. ship together, because a production file nobody imports fails the dead-code check:
   layout model, ids, normaliser, first-layout derivation, command reducer and property tests (pure); and the Worker table, `space.readTilingLayout` (with first materialisation) / `space.applyTilingCommand`, membership normalisation on snapshot writes, the `tiling.layout_updated` event, and the older-client, concurrent-first-read and event contract tests.
3. Tiling host with groups and tabs only (no splits), view switch and tiling target per client, child Space navigation, terminal remount covered by E2E.
4. Splits, dividers, minimum sizes, fold-for-display and the scroll fallback.
5. Keyboard prefix, hint line and commands.
6. Agent signals in tile headers and tabs.
