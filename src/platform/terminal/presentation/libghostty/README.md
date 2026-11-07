# libghostty-vt presentation engine

An alternative to the headless xterm that a presentation session keeps its
authoritative screen in. The browser keeps rendering with xterm.js; only the
worker-side state and the VT that hydrates the browser come from
[libghostty-vt](https://lib.ghostty.org/).

Off by default. Set `SESSION_DESK_TERMINAL_ENGINE=libghostty` for the process
that hosts presentation sessions to use it.

## Vendored module

| | |
| --- | --- |
| File | `ghostty-vt.wasm` (wasm32-freestanding, ReleaseSmall) |
| Source | ghostty-org/ghostty tag `vt-1.0.0` (commit `0fa3d57`) |
| SHA-256 | `ghostty-vt.wasm.sha256` |
| License | MIT; bundled third-party code in `lib-vt-packages.json` |

Rebuild with `node scripts/build-libghostty-vt-wasm.mjs --tag <tag>` (needs
Zig 0.17). Behind a proxy that Zig's package fetcher cannot use, download each
`deps.files.ghostty.org` tarball yourself, unpack it, and pass the directory to
`zig build` with `--fork=<dir>`.

## How serialization works

- The screen, scrollback and terminal state come from Ghostty's VT formatter
  with every extra (modes, keyboard flags, cursor, style, hyperlink, scrolling
  region, tab stops, charsets, palette, working directory).
- The formatter only emits the active screen. While the alternate screen is
  active, a snapshot copy of the terminal leaves it, the primary screen is
  formatted from the copy, and the alternate screen is replayed on top.
- LF also returns to column 0, matching xterm's `convertEol`.

## Known differences from xterm

- Regional-indicator flags take four cells instead of two.
