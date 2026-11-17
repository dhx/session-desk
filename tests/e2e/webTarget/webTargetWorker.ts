import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createInterface } from 'node:readline'
import path from 'node:path'

// Starts the headless worker. By default from the built app (`out/main/worker.js`) the same way
// `scripts/test-e2e-web-canvas.mjs` does: under Electron's Node (`ELECTRON_RUN_AS_NODE=1`), because
// the native modules in node_modules are built for Electron's ABI. With OPENCOVE_E2E_WEB_SERVER_DIR set
// to an unpacked server bundle (`opencove-server-linux-x64`), it runs that bundle's own Node and app,
// i.e. exactly what a release ships.

const repoRoot = path.resolve(__dirname, '../../../')
const WORKER_READY_TIMEOUT_MS = 45_000
const WORKER_STOP_TIMEOUT_MS = 5_000
const WORKER_LOG_TAIL_LINES = 40
// src/shared/constants/controlSurface.ts
const WORKER_CONNECTION_FILE = 'worker-control-surface.json'

export interface StartedWebTargetWorker {
  baseUrl: string
  token: string
  /** Null when the launch attached to a worker the test started itself (worker-client specs). */
  process: ChildProcess | null
  stop: () => Promise<void>
  logTail: () => string
}

function resolveElectronBinary(): string {
  const requireFromRepo = createRequire(path.join(repoRoot, 'package.json'))
  const electronBinary = requireFromRepo('electron') as unknown
  if (typeof electronBinary !== 'string' || electronBinary.length === 0) {
    throw new Error('[e2e-web] Could not resolve the Electron binary to run the worker with')
  }

  return electronBinary
}

function isTruthyEnv(rawValue: string | undefined): boolean {
  return rawValue === '1' || rawValue?.toLowerCase() === 'true'
}

function killWorkerTree(child: ChildProcess, signal: NodeJS.Signals): void {
  if (typeof child.pid !== 'number') {
    return
  }

  try {
    // The worker runs in its own process group, so its terminals go with it.
    process.kill(-child.pid, signal)
  } catch {
    try {
      child.kill(signal)
    } catch {
      // already gone
    }
  }
}

async function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return true
  }

  return await new Promise(resolve => {
    const timer = setTimeout(() => {
      child.off('exit', onExit)
      resolve(false)
    }, timeoutMs)
    const onExit = () => {
      clearTimeout(timer)
      resolve(true)
    }
    child.once('exit', onExit)
  })
}

function resolveWorkerCommand(): { command: string; workerPath: string; cwd: string } {
  const serverDir = process.env['OPENCOVE_E2E_WEB_SERVER_DIR']?.trim()
  if (serverDir) {
    const bundleRoot = path.resolve(serverDir)
    return {
      command: path.join(bundleRoot, 'runtime', 'node', 'bin', 'node'),
      workerPath: path.join(bundleRoot, 'app', 'out', 'main', 'worker.js'),
      cwd: path.join(bundleRoot, 'app'),
    }
  }

  return {
    command: resolveElectronBinary(),
    workerPath: path.join(repoRoot, 'out', 'main', 'worker.js'),
    cwd: repoRoot,
  }
}

// Worker-client specs start their own worker on the user data dir and then launch the app, which
// connects to it (OPENCOVE_WORKER_CLIENT). The Web UI equivalent is to open that worker's Web UI.
async function findRunningWorker(
  userDataDir: string,
): Promise<{ baseUrl: string; token: string } | null> {
  try {
    const raw = await readFile(path.join(userDataDir, WORKER_CONNECTION_FILE), 'utf8')
    const info = JSON.parse(raw) as {
      hostname?: unknown
      port?: unknown
      token?: unknown
      pid?: unknown
    }
    if (
      typeof info.hostname !== 'string' ||
      typeof info.port !== 'number' ||
      typeof info.token !== 'string' ||
      typeof info.pid !== 'number'
    ) {
      return null
    }
    process.kill(info.pid, 0)
    return { baseUrl: `http://${info.hostname}:${info.port}`, token: info.token }
  } catch {
    return null
  }
}

export async function startWebTargetWorker(options: {
  userDataDir: string
  approvedRoots: string[]
  /** 0 for any free port; a restart passes the previous port so the UI keeps its origin. */
  port: number
  env: Record<string, string>
}): Promise<StartedWebTargetWorker> {
  const running = await findRunningWorker(options.userDataDir)
  if (running) {
    // The desktop app approves its test roots in the shared store when it connects; do the same.
    await Promise.all(
      options.approvedRoots.map(root =>
        invokeWorker(running, 'command', 'workspace.approveRoot', { path: root }).catch(
          () => undefined,
        ),
      ),
    )
    return { ...running, process: null, stop: async () => undefined, logTail: () => '' }
  }

  const token = randomBytes(24).toString('hex')
  const { command, workerPath, cwd } = resolveWorkerCommand()
  const args = [
    workerPath,
    '--hostname',
    '127.0.0.1',
    '--port',
    String(options.port),
    '--user-data',
    options.userDataDir,
    ...options.approvedRoots.flatMap(root => ['--approve-root', root]),
  ]

  const child = spawn(command, args, {
    cwd,
    detached: process.platform !== 'win32',
    env: {
      ...options.env,
      ELECTRON_RUN_AS_NODE: '1',
      // The token goes through the environment, never argv (the worker scrubs it after reading).
      OPENCOVE_WORKER_TOKEN: token,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })

  const logLines: string[] = []
  const pipeLogs = isTruthyEnv(process.env['OPENCOVE_E2E_PIPE_ELECTRON_LOGS'])
  const remember = (chunk: Buffer) => {
    const text = chunk.toString('utf8')
    if (pipeLogs) {
      process.stderr.write(text)
    }
    logLines.push(...text.split('\n').filter(line => line.length > 0))
    if (logLines.length > WORKER_LOG_TAIL_LINES) {
      logLines.splice(0, logLines.length - WORKER_LOG_TAIL_LINES)
    }
  }
  child.stderr?.on('data', remember)
  const logTail = () => logLines.join('\n')

  let ownerPid: number | null = null
  const ready = await new Promise<{ hostname: string; port: number }>((resolve, reject) => {
    if (!child.stdout) {
      reject(new Error('[e2e-web] Worker stdout not available'))
      return
    }

    const rl = createInterface({ input: child.stdout })
    const timer = setTimeout(() => {
      rl.close()
      reject(new Error(`[e2e-web] Timed out waiting for the worker to start\n${logTail()}`))
    }, WORKER_READY_TIMEOUT_MS)

    rl.on('line', line => {
      try {
        const info = JSON.parse(line) as { hostname?: unknown; port?: unknown; pid?: unknown }
        if (typeof info.hostname === 'string' && typeof info.port === 'number') {
          clearTimeout(timer)
          rl.close()
          child.stdout?.on('data', remember)
          ownerPid = typeof info.pid === 'number' ? info.pid : null
          resolve({ hostname: info.hostname, port: info.port })
        }
      } catch {
        // not the ready line
      }
    })

    child.once('error', error => {
      clearTimeout(timer)
      rl.close()
      reject(error)
    })
    child.once('exit', code => {
      clearTimeout(timer)
      rl.close()
      reject(new Error(`[e2e-web] Worker exited before ready (code=${code})\n${logTail()}`))
    })
  }).catch(async error => {
    killWorkerTree(child, 'SIGKILL')
    await waitForExit(child, WORKER_STOP_TIMEOUT_MS)
    throw error
  })

  // A worker that finds another one owning this user data prints that one's address (and pid) and
  // exits (one owner per profile, upstream #523). Our token is not that one's: use its connection.
  if (ownerPid !== null && ownerPid !== child.pid) {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      // eslint-disable-next-line no-await-in-loop -- polls the owner's connection file.
      const owner = await findRunningWorker(options.userDataDir)
      if (owner) {
        return { ...owner, process: null, stop: async () => undefined, logTail }
      }
      // eslint-disable-next-line no-await-in-loop -- polls the owner's connection file.
      await new Promise(resolveDelay => setTimeout(resolveDelay, 100))
    }
  }

  let stopPromise: Promise<void> | null = null
  const stop = async () => {
    stopPromise ??= (async () => {
      child.kill('SIGTERM')
      const exited = await waitForExit(child, WORKER_STOP_TIMEOUT_MS)
      // Terminal processes outlive a graceful stop only by accident; a forced stop takes them along.
      killWorkerTree(child, 'SIGKILL')
      if (!exited) {
        await waitForExit(child, WORKER_STOP_TIMEOUT_MS)
      }
    })()
    await stopPromise
  }

  return {
    baseUrl: `http://${ready.hostname}:${ready.port}`,
    token,
    process: child,
    stop,
    logTail,
  }
}

async function invokeWorker<TValue>(
  worker: { baseUrl: string; token: string },
  kind: 'query' | 'command',
  id: string,
  payload: unknown,
): Promise<TValue> {
  const response = await fetch(`${worker.baseUrl}/invoke`, {
    method: 'POST',
    headers: { authorization: `Bearer ${worker.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ kind, id, payload }),
  })
  const envelope = (await response.json()) as
    | { ok: true; value: TValue }
    | { ok: false; error?: { code?: string } }
  if (!response.ok || !envelope.ok) {
    throw new Error(
      `[e2e-web] ${id} failed: ${response.status} ${
        envelope.ok ? '' : (envelope.error?.code ?? 'unknown_error')
      }`,
    )
  }

  return envelope.value
}

export async function issueWebSessionTicket(baseUrl: string, token: string): Promise<string> {
  const result = await invokeWorker<{ ticket: string }>(
    { baseUrl, token },
    'query',
    'auth.issueWebSessionTicket',
    { redirectPath: '/' },
  )
  return result.ticket
}
