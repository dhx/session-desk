# Our Session Desk releases

This fork, Session Desk, builds its own **server** releases (`session-desk-server-linux-x64.tar.gz`, worker + Web UI)
for [session-desk-image](https://github.com/dhx/session-desk-image). The build names the bundle
`opencove-server-linux-x64`, as upstream does; the release workflow repacks it so file and top folder carry our name.
Upstream's installer scripts and managed SSH still expect the old name, but neither runs from our releases. They are upstream's code plus our changes
(the list below), built by `.github/workflows/dhx-release.yml`.

## Cutting a release

**Automatically:** every push to `main` starts `dhx-release.yml` right away, in parallel with the `CI`
workflow (lint, types, unit tests and the web suites; the Electron desktop suite runs only by hand and does not
hold a release). It works out the next version (the next patch of `package.json`'s version with `-dhx-<nnn>`
counted up: `0.4.1-dhx-001`, `0.4.1-dhx-002`, …; when upstream moves to 0.4.1, `0.4.2-dhx-001`), then builds,
runs our checks and attests the bundle. It skips lint, types and unit tests, because CI runs those for the
same commit. When CI finishes green, `dhx-auto-release.yml` publishes that very build. A release is ready about
a minute after CI. Commits that `main` has already moved past (their CI is cancelled anyway) and commits that
already have a release are skipped.

**By hand:**

```sh
git tag dhx/v0.4.1-dhx-001 && git push origin dhx/v0.4.1-dhx-001
```

- **Version.** `<next upstream patch>-dhx-<nnn>`, e.g. `0.4.1-dhx-001` for upstream main after 0.4.0. The
  three digits sort correctly as text, and the next patch number makes it newer than the upstream release it
  builds on. Semver counts it as a pre-release, so a plugin that names a version range has to allow
  pre-releases.
- **Tags.** Ours start with `dhx/` (upstream's tags are `v*`).
- **What the workflow does:**
  1. Stamps the version and builds the server bundle (`pnpm build:standalone`).
  2. Runs the checks below.
  3. Publishes a GitHub release with the tarball, `SHA256SUMS.txt`, an SPDX SBOM and a build provenance
     attestation.
- **Trial build.** Every pull request, and a manual run (*Actions → dhx release → Run workflow*), builds
  and checks without publishing. The bundle is a workflow artifact.
- **Verify a download:**

  ```sh
  sha256sum -c SHA256SUMS.txt
  gh attestation verify session-desk-server-linux-x64.tar.gz --repo dhx/session-desk
  ```

## What a release checks

- **Inputs are pinned:**
  - The bundled Node runtime is the official tarball, checked against its SHA-256 (`NODE_VERSION`,
    `NODE_SHA256`). Upstream bundles whatever Node the runner happens to have.
  - Build images are pinned by digest, actions by commit, packages by `pnpm-lock.yaml`.
- **Upstream's cheap gates:** `secrets:scan`, `lint`, `format:check`, `check`, unit tests. The E2E suites
  run in CI; releases wait for the web ones, including upstream's Electron suite run against the Web UI
  (below).
- **`scripts/dhx/check-release-bundle.mjs`:** none of the markers in its `FORBIDDEN` list appear in the
  bundled code. That covers telemetry, analytics and crash-reporting SDKs and hosts, plus everything our
  changes removed. When a change removes something, add it there, so it can't come back unnoticed in an
  upstream merge.
- **`scripts/dhx/egress-smoke.sh`:**
  - The worker runs in a container without a network, with `scripts/dhx/egress-guard.cjs` loaded into
    every Node process.
  - It is used the way a person uses it, then left idle.
  - Any attempt to connect or resolve anything but loopback fails the release.
- **Upstream's container smoke test** of the bundle.

## The Electron suite on the Web UI

Upstream's end-to-end suite (`tests/e2e`) drives the Electron desktop app. We ship the worker with its Web
UI, so CI also runs that suite against the Web UI: the `e2e-web` job in `ci.yml` (8 shards), which releases
wait for.

- **How:** with `OPENCOVE_E2E_TARGET=web` (set by `playwright.e2e-web.config.ts`), `launchApp()` in
  `tests/e2e/workspace-canvas.app.ts` starts a fresh worker from the build (own user data dir and approved
  test roots), opens its Web UI in headless Chromium through a `/auth/claim` ticket and hands the spec that
  page as `window`. `electronApp.close()` stops worker and browser. A few main-process calls have web
  stand-ins (window size = viewport, clipboard = the page's, `app.quit()` = close, `process()` = the
  worker); every other Electron call fails with "Electron-only (OPENCOVE_E2E_TARGET=web)". Relaunching on
  the same user data dir restarts the worker on the same data and port. The harness is in
  `tests/e2e/webTarget/`; spec files are upstream's, unchanged.
- **Skip list:** `tests/e2e/webTarget/skips.ts`, one entry per file or test with a category and a reason.
  `tests/unit/e2e/webTargetSkips.spec.ts` fails when an entry names a file or title that no longer exists.
  Of the suite's 555 tests, 50 are on it: 33 Electron-only (main process, native website windows,
  system opening, desktop and Web UI side by side), 10 Web UI gaps (they seed images through the canvas
  images API the Web UI does not have yet), 3 desktop-only features (issue report, release notes, open in
  file manager), 2 Electron-native input (image paste, OS file drop; web tests cover the Web UI's own
  path), 1 refused by design (a workspace inside the worker's user data dir) and 1 Web UI bug (keys typed
  right after Ctrl+Shift+V overtake the pasted text). Another 98 skip themselves (Windows/macOS-only
  tests). `OPENCOVE_E2E_WEB_NO_SKIPS=1` runs the listed tests too.
- **Run it locally:**

  ```sh
  pnpm build
  pnpm exec playwright install --only-shell chromium
  pnpm exec playwright test -c playwright.e2e-web.config.ts tests/e2e/command-center.spec.ts
  ```

  `OPENCOVE_E2E_WEB_SERVER_DIR=<folder of an unpacked release>` runs a release bundle's own Node and
  app instead of the build (the worker otherwise runs under Electron's Node, like the web canvas suite).
  `OPENCOVE_E2E_PIPE_ELECTRON_LOGS=1` shows the worker's log.

## Staying with upstream

```sh
git remote add upstream https://github.com/DeadWaveWave/opencove   # once
git fetch upstream && git merge upstream/main                      # on a branch, as a pull request
```

The release checks run on the merge's next release. This fork deletes upstream's `release.yml` and
`nightly.yml` (desktop releases for macOS, Windows and Linux) and runs CI on Linux only. When upstream changes
those workflows or the macOS/Windows jobs in `ci.yml`, the merge reports a conflict; keep our side. A conflict in one of our changes shows up in the
merge, and a returning phone-home shows up in the checks.

## Our changes

| Change | Why |
|---|---|
| Release workflow and checks (`.github/workflows/dhx-release.yml`, `dhx-auto-release.yml`, `scripts/dhx/`) | Our own verified builds, released automatically when main is green (#1) |
| CI on Linux only: no `ci-macos` or `platform-e2e-windows` jobs; upstream's desktop `release.yml` and `nightly.yml` removed | We ship only the Linux server build; the macOS shards set the release time (#7) |
| The Electron desktop suite runs in its own workflow (`e2e-electron.yml`) only when started by hand; releases follow `CI` (lint, types, unit tests, web suites) only | We ship the Web UI, not the desktop app; the Electron shards set the release time (#8) and cost ~40 runner-minutes per run |
| Docs-only pull requests (`docs/**` except `docs/plugins/**`, root `*.md`) skip `CI` and the release trial build; `docs-check.yml` scans them for secrets. Pushes to `main` always run both | Docs changes cannot break the build; `dhx-auto-release` releases `main`'s head only after its CI run |
| Files dropped or pasted onto a terminal in the Web UI go to the worker (`/files/drop`), and their path is pasted | The Web UI had no way to pass a file to an agent (#2) |
| No auto-update, no GitHub plugin catalog unless `OPENCOVE_PLUGIN_CATALOG=1`, no default upstream downloads for managed SSH, no Gemini schema fetch, spellcheck off, issue reports to this fork; plugin views in an opaque origin, website nodes refuse the UI's own origin | Nothing contacts third parties on its own; plugin and website content cannot act as the UI (#3) |
| Token and password from env or file (not argv, not printed), no `?token=` unless enabled, Origin check for bearer requests, JSON and size limit on `/invoke`, `/debug/shell` off, security headers, Secure cookie behind TLS, no open bind without a password, database files 0600 | The worker's credentials stay out of process lists and logs; a token-injecting proxy is safe (#4) |
| Agents without permission bypass unless `OPENCOVE_AGENT_FULL_ACCESS` allows it; no executable/env overrides from the API; `approveRoot` refuses `/`, home and secret folders; SSH host/user validated; terminal shims send only what they need (`OPENCOVE_TERMINAL_AGENT_SHIMS=0` turns them off); no startup rewrite of `~/.claude`/`~/.codex`; private OpenCode config | Agents and API callers cannot escalate on their own (#5) |
| Upstream's Electron E2E suite also runs against the Web UI (`e2e-web` in `ci.yml`, `tests/e2e/webTarget/`, `playwright.e2e-web.config.ts`); Electron-only tests are in a checked skip list. The Web UI passes terminal foreground events to agent overlays | Releases are gated on what we ship, not on the desktop app; the suite found the missing foreground events (#9) |
| Canvas images in the Web UI: the worker keeps them as the desktop app does (`<userData>/canvas-images/<assetId>`) behind `PUT`/`GET`/`DELETE /canvas-images/<assetId>` | Pasting or dropping an image onto the canvas failed in the Web UI ("Canvas image uploads are unavailable") (#12) |
| A CI image for the browser E2E jobs (`ci/image/Dockerfile`, `.github/workflows/ci-image.yml`, `ghcr.io/dhx/session-desk-ci`): the Playwright image plus node-gyp tools and Electron's GTK 3. A Playwright bump means: new `FROM` tag and digest, publish, then pin the new digest in the jobs | No test run installs browsers or packages through apt |
| Named **Session Desk** in what people read: the Web UI's text (applied once where translations are looked up, `src/shared/brand/brand.ts`), page titles, the tab icon, and a not-official note on the login page and in the README. Code identifiers, the `opencove` CLI, package names and the release tarball keep upstream's names | OpenCove's `TRADEMARKS.md` asks a modified build to use a distinct name and say it is not official; keeping identifiers keeps upstream merges easy |
| Releases are titled **Session Desk** and published as `session-desk-server-linux-x64.tar.gz`, top folder included; their notes say the build is not an official OpenCove build | OpenCove's `TRADEMARKS.md` asks a modified build's distribution to use its own name |
| Files dropped onto the canvas in the Web UI are uploaded into the project (`<space or project folder>/dropped/`, `x-drop-directory` on `/files/drop`, only inside approved roots) and placed as file cards; folders get a message | A browser cannot pass a file's path, so the canvas refused dropped files; now they are kept with the project, agents find them next to the code, and they open in the document editor (#13) |
