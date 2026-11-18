#!/usr/bin/env node
// Release check: the server bundle contains none of the things our releases leave out. Each entry names a
// marker that must not appear in the bundled app code (app/out, app/src), and why. Add an entry when a
// change removes something, so it cannot come back unnoticed.
//
//   node scripts/dhx/check-release-bundle.mjs <extracted bundle dir>
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

export const FORBIDDEN = [
  // Telemetry, analytics and crash reporting: none upstream; keep it that way.
  { marker: /sentry\.io|@sentry\//, why: 'Sentry error reporting' },
  { marker: /posthog/i, why: 'PostHog analytics' },
  { marker: /api\.segment\.io|cdn\.segment\.com/, why: 'Segment analytics' },
  {
    marker: /api\.mixpanel\.com|api2\.amplitude\.com|api\.amplitude\.com/,
    why: 'product analytics',
  },
  { marker: /statsig/i, why: 'Statsig feature flags / analytics' },
  { marker: /datadoghq\.com|browser-intake-datadoghq/, why: 'Datadog' },
  { marker: /google-analytics\.com|googletagmanager\.com/, why: 'Google Analytics' },
  // Upstream's test-only reporter (src/app/main/runtimeDiagnostics.ts) keeps dumps local.
  {
    marker: /crashReporter\.start\((?![^)]*uploadToServer:\s*(?:false|!1)\b)/,
    why: 'Electron crash reporter that may upload',
  },
  // Things our builds removed (PR "no phone home"): each must stay gone.
  { marker: /["']electron-updater["']/, why: 'Electron auto-update against GitHub Releases' },
  {
    marker: /raw\.githubusercontent\.com\/google-gemini/,
    why: 'Gemini model list fetched from GitHub',
  },
  { marker: /DeadWaveWave\/opencove\/issues\/new/, why: "issue reports to upstream's tracker" },
  {
    marker: /DeadWaveWave\/opencove\/releases\/(download|latest)/,
    why: "managed SSH runtime downloaded from upstream's releases by default",
  },
  {
    marker: /allow-scripts allow-same-origin allow-popups allow-downloads allow-forms/,
    why: "plugin views sandboxed with the Web UI's own origin",
  },
  { marker: /connect-src 'self' https:/, why: 'plugin views allowed to connect to any https host' },
]

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    const st = statSync(path)
    if (st.isDirectory()) {
      yield* files(path)
    } else if (/\.(c?js|mjs|html|json)$/.test(name)) {
      yield path
    }
  }
}

const root = process.argv[2]
if (!root) {
  process.stderr.write('usage: check-release-bundle.mjs <extracted bundle dir>\n')
  process.exit(2)
}
const app = readdirSync(root).includes('app') ? join(root, 'app') : root
const hits = []
for (const sub of ['out', 'src']) {
  let dir
  try {
    dir = statSync(join(app, sub)).isDirectory() ? join(app, sub) : null
  } catch {
    dir = null
  }
  if (!dir) {
    continue
  }
  for (const file of files(dir)) {
    const text = readFileSync(file, 'utf8')
    for (const { marker, why } of FORBIDDEN) {
      if (marker.test(text)) {
        hits.push(`${file.slice(app.length + 1)}: ${why} (${marker})`)
      }
    }
  }
}
if (hits.length > 0) {
  process.stderr.write(
    `release bundle check: found what our releases leave out:\n${hits.join('\n')}\n`,
  )
  process.exit(1)
}
process.stdout.write(`release bundle check: none of ${FORBIDDEN.length} markers found\n`)
