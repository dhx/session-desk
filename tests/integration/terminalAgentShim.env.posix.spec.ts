// Session Desk (#5): the shim forwards only allow-listed shell variables to the gateway.
import { chmod, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { TerminalAgentActivityGateway } from '../../src/contexts/agent/infrastructure/terminal-activity/TerminalAgentActivityGateway'
import { TerminalAgentInvocationRegistry } from '../../src/contexts/agent/application/TerminalAgentInvocationRegistry'
import { TerminalAgentTelemetryAssetStore } from '../../src/contexts/agent/infrastructure/terminal-activity/TerminalAgentTelemetryAssetStore'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map(async root => await rm(root, { recursive: true, force: true })),
  )
})

function run(
  command: string,
  args: readonly string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; input?: string },
): Promise<{ code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => (stdout += String(chunk)))
    child.stderr.on('data', chunk => (stderr += String(chunk)))
    child.once('error', reject)
    child.once('exit', (code, signal) => resolve({ code, signal, stdout, stderr }))
    if (options.input !== undefined) {
      child.stdin.end(options.input)
    }
  })
}

describe.skipIf(process.platform === 'win32')('terminal Agent POSIX shim environment', () => {
  it('sends only the allow-listed shell variables to the gateway', async () => {
    const root = await mkdtemp(join(tmpdir(), 'opencove-terminal-shim-env-'))
    roots.push(root)
    const realBin = join(root, 'real')
    await mkdir(realBin)
    const realClaude = join(realBin, 'claude')
    await writeFile(
      realClaude,
      '#!/bin/sh\nprintf "CHILD_SECRET=%s\\n" "$OPENCOVE_TEST_SHELL_SECRET"\n',
    )
    await chmod(realClaude, 0o700)
    const seenEnvironments: Array<Readonly<NodeJS.ProcessEnv> | undefined> = []
    const gateway = new TerminalAgentActivityGateway({
      registry: new TerminalAgentInvocationRegistry(),
      resolveHookInjection: () => ({
        prepareHookInjection: async command => {
          seenEnvironments.push(command.environment)
          return { args: [], env: {}, hookInstallState: 'installed' }
        },
      }),
    })
    const terminal = await gateway.reserveTerminal()
    terminal.commit('pty-env')
    const assets = new TerminalAgentTelemetryAssetStore({
      parentDirectory: root,
      runtimeExecutable: process.execPath,
      platform: process.platform,
    })
    const published = await assets.ensure()

    const result = await run(process.execPath, [published.launcherPath, 'claude'], {
      cwd: root,
      env: {
        ELECTRON_RUN_AS_NODE: '1',
        HOME: root,
        CODEX_HOME: join(root, '.codex'),
        OPENCOVE_TEST_SHELL_SECRET: 'do-not-forward',
        ANTHROPIC_API_KEY: 'do-not-forward',
        OPENCOVE_TERMINAL_AGENT_ENDPOINT: terminal.endpoint,
        OPENCOVE_TERMINAL_AGENT_TOKEN: terminal.token,
        OPENCOVE_TERMINAL_AGENT_SHIM_DIRECTORY: published.shimDirectory,
        PATH: `${published.shimDirectory}:${realBin}:/usr/bin:/bin`,
      },
    })

    expect(result).toMatchObject({ code: 0, signal: null })
    // The provider itself still runs with the user's full shell environment.
    expect(result.stdout).toContain('CHILD_SECRET=do-not-forward')
    expect(seenEnvironments).toHaveLength(1)
    expect(seenEnvironments[0]).toEqual({
      HOME: root,
      CODEX_HOME: join(root, '.codex'),
      PATH: `${published.shimDirectory}:${realBin}:/usr/bin:/bin`,
    })
    await terminal.dispose()
    await assets.dispose()
    await gateway.dispose()
  })
})
