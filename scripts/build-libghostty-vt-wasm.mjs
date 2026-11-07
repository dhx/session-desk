#!/usr/bin/env node
// Rebuilds the vendored libghostty-vt wasm module from a Ghostty release tag.
//
//   node scripts/build-libghostty-vt-wasm.mjs [--tag vt-1.0.0] [--ghostty-dir <clone>]
//
// Needs git and Zig 0.17 (`ZIG` env var, default `zig`). Writes the module, its
// SHA-256 and Ghostty's third-party package report into the vendored directory.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const repoRoot = resolve(import.meta.dirname, '..')
const vendorDir = join(repoRoot, 'src/platform/terminal/presentation/libghostty')

function argument(name, fallback) {
  const index = process.argv.indexOf(name)
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}

function run(command, args, cwd) {
  execFileSync(command, args, { cwd, stdio: 'inherit' })
}

const tag = argument('--tag', 'vt-1.0.0')
const zig = process.env.ZIG ?? 'zig'
let ghosttyDir = argument('--ghostty-dir', null)

if (!ghosttyDir) {
  ghosttyDir = join(mkdtempSync(join(tmpdir(), 'ghostty-')), 'ghostty')
  run('git', [
    'clone',
    '--depth',
    '1',
    '--branch',
    tag,
    'https://github.com/ghostty-org/ghostty',
    ghosttyDir,
  ])
} else if (!existsSync(join(ghosttyDir, 'build.zig'))) {
  throw new Error(`${ghosttyDir} is not a Ghostty checkout`)
}

const buildArgs = ['-Demit-lib-vt', '-Dtarget=wasm32-freestanding', '-Doptimize=ReleaseSmall']
run(zig, ['build', ...buildArgs], ghosttyDir)
const reportDir = mkdtempSync(join(tmpdir(), 'ghostty-report-'))
run(zig, ['build', 'lib-vt-packages', ...buildArgs, '--prefix', reportDir], ghosttyDir)

const wasm = join(ghosttyDir, 'zig-out/bin/ghostty-vt.wasm')
copyFileSync(wasm, join(vendorDir, 'ghostty-vt.wasm'))
const report = JSON.parse(readFileSync(join(reportDir, 'lib-vt-packages.json'), 'utf8'))
writeFileSync(join(vendorDir, 'lib-vt-packages.json'), `${JSON.stringify(report, null, 4)}\n`)
const digest = createHash('sha256').update(readFileSync(wasm)).digest('hex')
writeFileSync(join(vendorDir, 'ghostty-vt.wasm.sha256'), `${digest}  ghostty-vt.wasm\n`)

process.stdout.write(
  `libghostty-vt ${tag}: ${digest}\n` +
    'Update the tag and checksum in src/platform/terminal/presentation/libghostty/README.md.\n',
)
