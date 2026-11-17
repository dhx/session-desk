// Session Desk: how `opencove worker start` hands its options to the worker process.
//
// Secrets never go on the worker's command line, which every local user can read (ps,
// /proc/<pid>/cmdline). They travel in the child's environment, which the worker reads and then
// scrubs (src/app/worker/workerSecrets.ts). File options carry only a path.

const SECRET_ENV_BY_OPTION = {
  token: 'OPENCOVE_WORKER_TOKEN',
  'web-ui-password': 'OPENCOVE_WEB_UI_PASSWORD',
  'web-ui-password-hash': 'OPENCOVE_WEB_UI_PASSWORD_HASH',
} as const

const VALUE_OPTIONS = [
  'hostname',
  'advertise-hostname',
  'port',
  'user-data',
  'token-file',
  'web-ui-password-file',
  'approve-root',
] as const

const FLAG_OPTIONS = ['allow-insecure-bind', 'allow-query-token'] as const

export interface WorkerStartForwarding {
  args: string[]
  secretEnv: Record<string, string>
}

export function buildWorkerStartForwarding(
  options: Readonly<Record<string, unknown>>,
): WorkerStartForwarding {
  const args: string[] = []
  for (const key of VALUE_OPTIONS) {
    const value = options[key]
    if (value !== undefined) {
      for (const item of Array.isArray(value) ? value : [value]) {
        args.push(`--${key}=${String(item)}`)
      }
    }
  }
  for (const key of FLAG_OPTIONS) {
    if (options[key] === true) {
      args.push(`--${key}`)
    }
  }
  const secretEnv: Record<string, string> = {}
  for (const [key, envName] of Object.entries(SECRET_ENV_BY_OPTION)) {
    const value = options[key]
    if (typeof value === 'string' && value.length > 0) {
      secretEnv[envName] = value
    }
  }
  return { args, secretEnv }
}
