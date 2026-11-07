import { mkdtempSync, readFileSync, readlinkSync, rmSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BROWSER_BRIDGE_SCRIPT,
  BROWSER_BRIDGE_SCRIPT_NAME,
  installBrowserBridge,
  needsBrowserBridge,
  withBrowserBridgeEnv,
} from '../../../src/platform/terminal/browserBridge'
import { TerminalProfileResolver } from '../../../src/platform/terminal/TerminalProfileResolver'

const dirs: string[] = []
afterEach(() => {
  dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true }))
})

describe('browser bridge', () => {
  it('is only for headless Linux terminals without a BROWSER of their own', () => {
    expect(needsBrowserBridge({}, 'linux')).toBe(true)
    expect(needsBrowserBridge({ DISPLAY: ':0' }, 'linux')).toBe(false)
    expect(needsBrowserBridge({ WAYLAND_DISPLAY: 'wayland-0' }, 'linux')).toBe(false)
    expect(needsBrowserBridge({ BROWSER: 'w3m' }, 'linux')).toBe(false)
    expect(needsBrowserBridge({}, 'darwin')).toBe(false)
    expect(needsBrowserBridge({}, 'win32')).toBe(false)
  })

  it('points BROWSER at the script and puts its folder last on PATH', () => {
    const env = withBrowserBridgeEnv({ PATH: '/usr/bin:/bin' }, '/home/u/.cache/session-desk/bin')
    expect(env.BROWSER).toBe(`/home/u/.cache/session-desk/bin/${BROWSER_BRIDGE_SCRIPT_NAME}`)
    expect(env.PATH).toBe('/usr/bin:/bin:/home/u/.cache/session-desk/bin')
    expect(withBrowserBridgeEnv(env, '/home/u/.cache/session-desk/bin').PATH).toBe(env.PATH)
  })

  it('writes an executable script and an xdg-open link into the cache folder', () => {
    const home = mkdtempSync(path.join(os.tmpdir(), 'bridge-'))
    dirs.push(home)
    const binDir = installBrowserBridge({}, home)
    expect(binDir).toBe(path.join(home, '.cache', 'session-desk', 'bin'))
    const script = path.join(binDir as string, BROWSER_BRIDGE_SCRIPT_NAME)
    expect(readFileSync(script, 'utf8')).toBe(BROWSER_BRIDGE_SCRIPT)
    expect(statSync(script).mode & 0o777).toBe(0o755)
    expect(readlinkSync(path.join(binDir as string, 'xdg-open'))).toBe(BROWSER_BRIDGE_SCRIPT_NAME)
    expect(installBrowserBridge({}, home)).toBe(binDir)
    expect(installBrowserBridge({ XDG_CACHE_HOME: 'relative' }, home)).toBeNull()
  })

  it('is set up once per resolver for Linux terminal and agent spawns', async () => {
    const install = vi.fn(() => '/cache/session-desk/bin')
    const resolver = new TerminalProfileResolver({
      platform: 'linux',
      env: () => ({ PATH: '/usr/bin' }),
      installBrowserBridge: install,
    })

    const shell = await resolver.resolveTerminalSpawn({ cwd: '/repo', cols: 80, rows: 24 })
    const agent = await resolver.resolveCommandSpawn({ cwd: '/repo', command: 'codex', args: [] })
    const own = await resolver.resolveCommandSpawn({
      cwd: '/repo',
      command: 'codex',
      args: [],
      env: { BROWSER: 'firefox' },
    })

    expect(shell.env.BROWSER).toBe(`/cache/session-desk/bin/${BROWSER_BRIDGE_SCRIPT_NAME}`)
    expect(agent.env.BROWSER).toBe(shell.env.BROWSER)
    expect(agent.env.PATH).toBe('/usr/bin:/cache/session-desk/bin')
    expect(own.env.BROWSER).toBe('firefox')
    expect(install).toHaveBeenCalledTimes(1)
  })
})
