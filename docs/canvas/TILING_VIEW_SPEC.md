# Tiling View Spec

This spec defines a second way to look at a Space: a **tiling view** that arranges the Space's windows as non-overlapping tiles filling the screen, driven mostly by the keyboard. The canvas stays the default and stays untouched.

Status: Proposed (Large change). Awaiting approval of this spec, then a feasibility check (section 9), then a plan. Nothing here is implemented yet.

## Problem Class

This is a mature problem: tiling window management. Terminal multiplexers, tiling window managers and editors have solved arranging many live panes on one screen, and their users have strong habits (split, focus by direction, maximise, tab). The local constraints are the Session Desk ones: windows are React Flow nodes on an infinite canvas, terminals are clients of Worker-owned PTY sessions, several clients (Desktop and Web) can show the same workspace at once, and Agent status already drives the sidebar minimap.

## External References

- [i3 user's guide: tree](https://i3wm.org/docs/userguide.html#_tree): the layout is a tree of containers; each container splits horizontally or vertically or stacks its children as tabs, and leaves are windows. Focus moves by direction, and a new window opens next to the focused one.
- [sway](https://swaywm.org/): the same tree model on Wayland; shows the model survives a different rendering stack.
- [tmux](https://man.openbsd.org/tmux.1): panes in windows, a prefix key for commands, zoom (`resize-pane -Z`) to maximise one pane and restore the layout, and the rule that a pane's process outlives its pane's view.
- [GNU Emacs: Windows](https://www.gnu.org/software/emacs/manual/html_node/emacs/Windows.html): splitting the selected window, `other-window`, and window configurations that can be saved and restored apart from the buffers they show.
- [VS Code editor groups](https://code.visualstudio.com/docs/getstarted/userinterface#_editor-groups): a grid of groups, each a tab stack; splitting moves or copies the active editor into a new group; empty groups close.
- [Zellij layouts](https://zellij.dev/documentation/layouts): declarative pane layouts and a status bar that teaches the current mode's keys.
- [DreamCoder](https://www.masteringemacs.org/article/announcing-dreamcoder): panes with minimum, comfortable and maximum sizes laid out by a constraint solver, overflow panes moved to a hidden bar, workspaces as virtual desktops, and a per-workspace status minimap. Only the ideas are borrowed, not the look.

What transfers:

- **A tree of splits with tab groups as leaves** (i3, VS Code). It is easy to reason about, to test and to serialise; every layout people use daily is expressible in it.
- **The layout is separate from what it shows** (Emacs, tmux). Closing the tiling view, or closing a tile, never ends the process behind it.
- **Tabs, not a hidden bar, for overflow.** A tab group shows that more windows are there and how to reach them; a hidden bar needs a second place to look. DreamCoder's constraint solver is set aside for now: minimum sizes plus tabs cover the same need with a model a person can predict.
- **Zoom** (tmux): maximise one tile and restore the layout exactly.
- **A visible mode hint** (Zellij) while a prefix is armed, so the keys are discoverable.

## 1. Business Logic

### 1.1 View mode

- Each Space can be shown as **Canvas** (today) or **Tiling**.
- The choice is **per client window** and not synced: switching one browser tab or Desktop window to Tiling changes nothing for other windows or other people looking at the same workspace (as on the Session Board, where a window can switch a space's layout alone).
- A per-client default can be set in settings: Canvas (default) or Tiling. The last mode used for a Space in this client is remembered for that client.
- The tiling view shows one Space at a time: the active Space. Switching Space (sidebar, keyboard) shows that Space's tiles. A child Space has its own layout; its windows do not appear in its parent's tiles.

### 1.2 Layout

- A Space's layout is a tree:
  - a **split** has a direction (row or column), two or more children and a weight per child;
  - a **group** is a leaf: an ordered list of windows shown as tabs, with one active window.
- Every window of the Space is in exactly one group. A group with one window shows no tab strip, only the window's own header.
- The layout is **shared**: it belongs to the Space and is stored with it, so every client in Tiling mode sees the same arrangement, and it survives restarts. Canvas positions and sizes are never changed by the tiling view, and the tiling layout is never changed by moving windows on the canvas.
- When a Space has no layout yet, the first switch to Tiling derives one from the canvas: windows are sorted in reading order (rows by top edge, then left edge) and placed in a balanced grid of groups, up to a limit set by the screen and the windows' minimum sizes; the rest become tabs in the last groups. The derived layout is stored only once the person changes it.

### 1.3 Windows coming and going

- A new window created while the Space is in Tiling opens **next to the focused tile**: it splits the focused group along its longer side if both halves keep their minimum size, otherwise it becomes a new tab in the focused group and is activated.
- A window created elsewhere (on the canvas in another client, by an Agent, by restore) joins the **last focused group** as a new, inactive tab, so nothing jumps under the person's hands.
- A window that leaves the Space (closed, moved to another Space, archived) leaves its group; an empty group is removed and its split's weights are renormalised; a split with one child collapses into that child.

### 1.4 Sizes

- Every window kind has a **minimum tile size** in CSS pixels; for terminals it is derived from a minimum of 40 columns by 8 rows at the current font.
- Dragging a divider changes the weights of the two neighbours, clamped so neither drops below its minimum.
- When the screen shrinks so a split can no longer hold its children at minimum size, the view does not overlap or cut tiles: it **folds** the smallest child into its neighbour as tabs for display only. The stored layout is unchanged, so growing the screen again restores it.
- **Zoom** shows the focused tile alone over the whole view; zoom again restores the layout. Zoom is per client and not stored.

### 1.5 Keyboard

The tiling view is usable without a pointer. Commands are bound under a **prefix** (proposal: `Alt+Space`, configurable alongside the existing canvas commands), so they do not collide with terminal programs. After the prefix a hint line lists the keys until a key is pressed or `Escape`:

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
| `c` | Switch this Space back to Canvas |

The application shortcuts of `docs/ui/APPLICATION_SHORTCUTS.md` keep working unchanged. Key choices respect what browsers do not let a page intercept; the Web UI and Desktop share one map.

### 1.6 Attention and status

- Each tile header and tab shows the window's Agent signal (working, waiting, done, failed) with the same tokens as the sidebar minimap, so a waiting Agent in a background tab is still visible.
- While a Space is in Tiling in this client, the sidebar minimap for that Space draws the tiles' geometry instead of the canvas geometry, so the map matches what is on screen. (Open question 10.2.)

### 1.7 Acceptance criteria

1. Switching a Space with a running Agent terminal from Canvas to Tiling and back neither restarts nor duplicates the PTY session, keeps scrollback, and keeps the Agent's status.
2. The canvas positions and sizes of every window are byte-identical before and after any sequence of tiling commands.
3. Two clients in Tiling mode on one Space see the same layout after either changes it; a third client on the Canvas sees no change at all.
4. Every window of the Space is reachable in Tiling, by pointer and by keyboard alone.
5. No tile is ever drawn below its minimum size or overlapping another; shrinking and restoring the window restores the stored layout exactly.
6. A terminal tile resize reaches the PTY as one resize at the end of a divider drag, not one per frame.
7. Reload in Tiling mode restores the same layout, focus and active tabs.

## 2. State Owners and Invariants

| State | Owner | Persisted / synced |
| --- | --- | --- |
| View mode per Space, zoom, fold-for-display, focused tile, prefix armed | Renderer, per client (canvas store slice `tiling`) | View mode and last-used remembered in client-local UI preferences; the rest runtime only |
| Layout tree of a Space (splits, weights, groups, tab order, active tab) | Workspace document, as a field of the Space | Yes: new nullable column on `workspace_spaces` (JSON), written through the existing canvas document commands and synced like other Space fields |
| Window membership of a Space | Unchanged: `space.nodeIds` | Unchanged |
| Terminal session, screen, controller role | Unchanged: Worker / `PtyStreamHub` | Unchanged |

Invariants:

1. **Membership:** the set of windows in a Space's layout equals `space.nodeIds` after every write. The layout never names a window outside the Space and never misses one; this is enforced by one normalising function applied on every read and every write, not by each command.
2. **Separation:** no tiling command writes a window's canvas position or size, and no canvas command writes the layout tree (except membership normalisation).
3. **One client view per window:** in one client, a window is mounted either on the canvas or in a tile, never both, so a terminal has exactly one xterm client per window per client.

## 3. Top Risks

- **Terminal remount.** Switching view unmounts the canvas xterm and mounts a tile xterm. Correctness comes from the Worker snapshot and stream replay (`docs/terminal/MULTI_CLIENT_ARCHITECTURE.md`), the same path as switching workspace, but it has never been exercised as a frequent user action. Risks: visible flicker, lost focus, a resize storm to the PTY, controller-role handoff surprises with several clients.
- **Native website views on Desktop.** Website windows may render as native views positioned over the canvas, not DOM. They must follow the tile's rectangle and z-order, and be hidden in background tabs.
- **Hub files.** The canvas code is under an active refactoring plan with mechanical subscriber checks (`DEVELOPMENT.md`, S3–S7). The tiling view must be a sibling host that reads the same document commands, not new branches inside `WorkspaceCanvasInner`.
- **Shortcut collisions** with terminal programs (Emacs, vim, readline) and with browser-reserved keys in the Web UI.
- **Two layouts drifting:** a person who mostly uses Tiling may forget the canvas still exists; windows created in Tiling need a sensible canvas position too (the existing placement for new windows applies).

## 4. Data Model (proposal)

```ts
type TilingLayout = { version: 1; root: TilingNode }
type TilingNode =
  | { kind: 'split'; direction: 'row' | 'column'; children: TilingNode[]; weights: number[] }
  | { kind: 'group'; nodeIds: string[]; activeNodeId: string }
```

- `weights` has the same length as `children`, entries are positive and sum to 1 (normalised on write).
- Ids are window node ids; groups and splits have no own ids (the path from the root addresses them), so concurrent membership changes cannot leave dangling ids.
- `normalizeTilingLayout(layout | null, nodeIds) → TilingLayout` is the single place that enforces invariant 1: drops unknown ids, appends missing ones to the last group, removes empty groups and collapses single-child splits.

## 5. Rendering

- A new host component, a sibling of the canvas host, renders the tree with CSS grid/flex and plain dividers (no new layout dependency for v1).
- Tiles render the existing window bodies (terminal, Agent, note, document, website) through the same node components the canvas uses, without React Flow's node wrapper; window chrome (title, actions, Agent signal) comes from the shared window header.
- A divider drag updates weights in the client's interaction slice per frame and writes the document once on release, mirroring the canvas drag rules (no per-frame document writes, no per-frame PTY resizes).

## 6. Accessibility

- Each tile is a labelled region; tab strips use the ARIA tabs pattern; dividers are focusable separators with arrow-key resizing.
- Focus is always on exactly one tile; moving focus by keyboard moves DOM focus into the tile's content.
- The prefix hint line is announced politely. Reduced motion disables any tile transition.
- In forced-colours mode the focused tile and the Agent signals have outlines, not only colour or shadow.

## 7. Out of Scope for v1

- Floating windows inside the tiling view.
- A constraint solver for sizes (comfortable/maximum sizes); revisit if folding to tabs proves too coarse.
- Several Spaces tiled side by side.
- Saved named layouts per Space.
- Phone layout (the tiling view on a narrow screen shows one tile with tabs; a proper phone view is its own design).

## 8. Verification Plan

- **Unit (pure):** the layout reducer and `normalizeTilingLayout`, with property-based tests: for random sequences of commands and membership changes, invariant 1 holds and canvas geometry is untouched (invariant 2). Fold-for-display is a pure function of layout and screen size, tested the same way.
- **Contract:** the persistence migration (new nullable column), round-trip of the layout through SQLite and through the sync path; an old client ignores the field.
- **Type:** the layout type is the only shape the document accepts; command functions take and return it, so a raw object cannot be written.
- **E2E (Desktop and Web):** acceptance 1 (switch with a running terminal: same session id, scrollback present, no second attach), 3 (two clients), 6 (one resize per drag), 7 (reload). Added to the E2E budget with reasons.
- **Visual:** screenshots of light, dark and forced-colours themes for the PR.

## 9. Feasibility Check (before the plan)

A throwaway branch proves the riskiest part only: switch one Space between the canvas and a single full-screen tile showing a running Agent terminal and a website window.

Measure and report:

- the PTY session id and the Worker's attach count before and after ten switches (expected: same id, one attach per mount);
- time from switch to first painted terminal frame;
- resizes reaching the PTY per switch;
- whether a Desktop native website view follows the tile and hides correctly.

If remounting proves too costly, the fallback is to keep window bodies mounted in a portal and move them between hosts; the check decides between the two.

## 10. Open Questions

1. Default prefix key (`Alt+Space` proposed) for Desktop and Web.
2. Should the sidebar minimap follow the tiling geometry for Spaces in Tiling (1.6), or always show the canvas?
3. Should "close tile" close the window (as on the canvas) or only remove it from view? Proposal: close the window, like tmux and i3; there is no "hidden but open" state.
4. Child Spaces: tile only the active Space (proposed) or show child Spaces as tabs in the parent's layout?

## 11. Delivery Slices (sketch, for the plan)

1. Layout model, reducer, normalisation and property tests (pure, no UI).
2. Persistence column, migration and sync.
3. Tiling host with groups and tabs only (no splits), view switch per client, terminal remount covered by E2E.
4. Splits, dividers, minimum sizes and fold-for-display.
5. Keyboard prefix, hint line and commands.
6. Agent signals in tile headers and the minimap question.
