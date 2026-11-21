> **Session Desk** is a fork of [OpenCove](https://github.com/DeadWaveWave/opencove) that ships only the server build
> (worker + Web UI). It is **not an official OpenCove build**; the OpenCove name and logo belong to its steward
> ([TRADEMARKS.md](./TRADEMARKS.md)). What this fork changes: [docs/dhx/RELEASES.md](./docs/dhx/RELEASES.md).

<div align="center">

<img src="./src/app/renderer/assets/brand/session-desk-mark.svg" alt="" width="72" />

# Session Desk

**An infinite canvas for Claude Code, Codex, terminals, tasks, and notes — in your browser.**

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Status](https://img.shields.io/badge/status-alpha-orange.svg)]()
[![Platform](https://img.shields.io/badge/platform-Linux%20server%20%2B%20browser-lightgrey)]()

[Releases](https://github.com/dhx/session-desk/releases) · [What this fork changes](./docs/dhx/RELEASES.md)

</div>

## 📖 What is Session Desk?

Session Desk is a **spatial development workspace** for people who work with AI coding agents every day. It runs
as a server (the worker) and you use it from a browser (the Web UI).

Instead of burying work inside tabs, sidebars, and long chat threads, Session Desk puts your **AI agents**,
**terminals**, **tasks**, and **notes** on the same infinite 2D canvas, so the full state of your work stays visible.

It is built for workflows like:

- Running multiple `Claude Code` or `Codex` sessions side by side
- Keeping task plans, notes, and terminal output in one shared workspace
- Switching projects without losing layout, context, or execution history

## ✨ Highlights

- **🌌 Infinite spatial canvas**: Arrange terminals, notes, tasks, and agent sessions the way you actually think.
- **🤖 Built for CLI agents**: Optimized for `Claude Code`, `Codex`, and similar terminal-native agent workflows.
- **🧠 Context stays visible**: Planning, execution, and results live together instead of getting buried in linear chat history.
- **💾 Persistent workspaces**: Restore your viewport, layout, terminal output, and agent state after restarts.
- **🗂️ Space archives**: Snapshot and revisit previous workspace states when you need to jump back into old contexts.
- **🖼️ Files and images from your machine**: Drop or paste files onto terminals and the canvas; they go to the server and open in the editor.
- **🔍 Global search and control center**: Search across the canvas and terminal output, then manage active sessions from one place.
- **🗂️ Workspace isolation**: Separate projects cleanly with directories and git worktrees.

## 💡 Why Session Desk?

Session Desk is designed around a simple idea: **agent workflows are easier to reason about when context is
spatial, not hidden**.

What this fork adds to that: nothing in it contacts third parties on its own, the worker's credentials stay out of
process lists and logs, agents and API callers cannot escalate on their own, and every release is built, checked
(including a no-network test of the worker) and attested in CI. The list is in [docs/dhx/RELEASES.md](./docs/dhx/RELEASES.md).

*Session Desk is in Alpha.*

## 🚀 Getting Started

### Server release

Each release on the [Releases](https://github.com/dhx/session-desk/releases) page holds the Linux server bundle
(worker + Web UI, with its own Node runtime), its `SHA256SUMS.txt`, an SBOM and a build provenance attestation:

```bash
sha256sum -c SHA256SUMS.txt
gh attestation verify session-desk-server-linux-x64.tar.gz --repo dhx/session-desk
```

Unpack it and start the worker. The command-line tool keeps the name `opencove` (code names stay as they are, so
upstream changes merge easily):

```bash
tar -xzf session-desk-server-linux-x64.tar.gz && cd session-desk-server-linux-x64
OPENCOVE_WORKER_TOKEN='<token>' OPENCOVE_WEB_UI_PASSWORD='change-me' \
  runtime/node/bin/node app/src/app/cli/opencove.mjs worker start --hostname 0.0.0.0
```

It prints the Web UI address. Keep a password set whenever the Web UI is reachable beyond localhost; the worker
refuses to listen on all interfaces without one. Tokens and passwords come from the environment, not from the
command line.

[opencove-image](https://github.com/dhx/opencove-image) runs it in a container with a passkey login in front.

### Coordinate agents from the CLI

```sh
opencove whoami --fields lineageQuota
opencove context --fields self.lineageQuota
opencove agent read --node "Reviewer" --node "Lead"
opencove agent read --node "Reviewer" --node "Lead" --screen --lines 20
```

Quota uses the Worker's spawn-admission census: depth ≤3 and up to 6 live agent-created
runtimes per tree, excluding the user root. Older Workers omit quota fields. Spawn refusals name
occupying nodes: agents use `opencove agent stop --node <id>`; for terminals, retrieve
`node.sessionId` with `opencove node get --node <id> --fields sessionId`, then run
`opencove session kill --session <sessionId>`. Multiple reads (up to 10 selectors) return an ordered
JSON array with per-target `node`, `ok`, and reply fields or `error`.
Failures preserve the other results; exit is 0 for all successes, otherwise the first failing target's
exit code. `--turn` requires a single target; `--expect-turn` is unsupported by `agent read`.
See [CLI documentation](docs/cli/README.md) or `opencove skill read` for details.

### Building from Source

#### Prerequisites
- Node.js `>= 22.12.0`
- pnpm `9.6.0`
- (Recommended) `Claude Code` or `Codex` installed, to try the agent workflows.

#### Build Instructions

```bash
git clone https://github.com/dhx/session-desk.git
cd session-desk
pnpm install
pnpm build:standalone   # the server bundle, as the release workflow builds it
```

The Web UI is served by the worker. Details:
- `docs/architecture/CONTROL_SURFACE.md`
- `docs/runtime/WEB_UI_TROUBLESHOOTING.md`
- `docs/dhx/RELEASES.md` (releases, checks, tests against the Web UI)

## 🏗️ Technical Architecture

- **Worker**: Node.js, serving the control surface, terminals and the Web UI.
- **Web UI**: React + TypeScript, built with `electron-vite`.
- **Canvas Engine**: `@xyflow/react` for smooth infinite canvas interactions.
- **Terminals**: `xterm.js` and `node-pty` powering full PTY runtimes.
- **Testing**: `Vitest` and `Playwright`; the end-to-end suite runs against the Web UI in a browser.

## 📄 License

[MIT](./LICENSE). The trademark rules for the upstream name and logo are in [TRADEMARKS.md](./TRADEMARKS.md).
