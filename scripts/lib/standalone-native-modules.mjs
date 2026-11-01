import { existsSync as defaultExistsSync, realpathSync as defaultRealpathSync } from 'node:fs'
import { resolve } from 'node:path'

export const STANDALONE_NATIVE_MODULE_NAMES = ['better-sqlite3', 'node-pty']

/**
 * Native files that ship prebuilt inside their npm package and are used as is, never rebuilt with
 * node-gyp. They are N-API, so one binary serves both Electron and the bundled Node. Only the
 * linux-x64 files are packed (see `build.linux.files` in package.json); these are what the
 * glibc floor check reads, relative to the bundle's `node_modules`.
 */
export const STANDALONE_PREBUILT_NATIVE_ARTIFACTS = Object.freeze([
  ['onnxruntime-node', 'bin', 'napi-v3', 'linux', 'x64', 'onnxruntime_binding.node'],
  ['onnxruntime-node', 'bin', 'napi-v3', 'linux', 'x64', 'libonnxruntime.so.1'],
  // transformers.js imports sharp. libvips' file name carries its version: when a sharp update
  // changes it, this check fails closed as "missing", and the new name goes here.
  ['@img', 'sharp-linux-x64', 'lib', 'sharp-linux-x64.node'],
  ['@img', 'sharp-libvips-linux-x64', 'lib', 'libvips-cpp.so.8.17.3'],
])

/**
 * Executables that some native modules produce on some platforms only. node-pty gates its
 * spawn-helper target behind `OS=="mac"` in binding.gyp, so a Linux or Windows bundle never
 * contains it. Anything listed here is chmod-ed only when it actually exists.
 */
const OPTIONAL_NATIVE_EXECUTABLES = [['node-pty', 'build', 'Release', 'spawn-helper']]

/**
 * Resolves where node-gyp should run for each native module, and where its build output goes.
 *
 * node-pty's binding.gyp shells out to `node -p "require('node-addon-api')..."`, which resolves
 * modules against `process.cwd()`. pnpm installs packages behind a link in `node_modules/<name>`
 * pointing into `node_modules/.pnpm/...`. POSIX canonicalizes cwd during chdir, so the package's
 * own dependencies stay reachable through the real directory; Windows junctions keep the link
 * path, and the lookup escapes to the (non-hoisted) root `node_modules` and fails. Running from
 * the realpath makes the behavior identical on every platform.
 */
export function resolveNativeModuleRebuildTargets({
  rootDir,
  appRoot,
  moduleNames = STANDALONE_NATIVE_MODULE_NAMES,
  realpathSync = defaultRealpathSync,
}) {
  return moduleNames.map(moduleName => {
    const linkedPath = resolve(rootDir, 'node_modules', moduleName)
    let modulePath = linkedPath
    try {
      modulePath = realpathSync(linkedPath)
    } catch {
      // A missing link is reported by node-gyp itself with a far clearer message.
    }

    return {
      moduleName,
      cwd: modulePath,
      sourceRelease: resolve(modulePath, 'build', 'Release'),
      destinationRelease: resolve(appRoot, 'node_modules', moduleName, 'build', 'Release'),
    }
  })
}

/**
 * Lists bundled native executables that need their executable bit restored, skipping any the
 * current platform never builds. Windows has no executable bit to restore.
 */
export function resolveOptionalNativeExecutables({
  appRoot,
  platform = process.platform,
  existsSync = defaultExistsSync,
}) {
  if (platform === 'win32') {
    return []
  }

  return OPTIONAL_NATIVE_EXECUTABLES.map(segments =>
    resolve(appRoot, 'node_modules', ...segments),
  ).filter(path => existsSync(path))
}
