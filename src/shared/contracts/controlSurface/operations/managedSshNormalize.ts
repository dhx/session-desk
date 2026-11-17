import { createAppError } from '../../../errors/appError'
import type {
  PrepareWorkerEndpointInput,
  RegisterManagedSshWorkerEndpointInput,
  RepairWorkerEndpointInput,
  UpdateManagedSshWorkerEndpointInput,
} from '../../dto'
import { parseOptionalManagedSshPort } from '../../managedSshPort'
import {
  findManagedSshHostProblem,
  findManagedSshUsernameProblem,
} from '../../managedSshDestination'
import { parseRuntimeBuildIdentity } from '../../runtimeBuild'
import {
  isRecord,
  normalizeOptionalString,
  normalizeRequiredString,
} from './topologyBrowseNormalize'
export function normalizeOptionalManagedSshPort(value: unknown, debugName: string): number | null {
  if (value === null || value === undefined) {
    return null
  }

  if (typeof value !== 'number') {
    throw createAppError('common.invalid_input', { debugMessage: `Invalid ${debugName}.` })
  }

  const result = parseOptionalManagedSshPort(String(value))
  if (result.state !== 'valid') {
    throw createAppError('common.invalid_input', { debugMessage: `Invalid ${debugName}.` })
  }

  return result.value
}

// Session Desk: host and user end up in an ssh command line, so neither may look like an option
// or carry characters ssh or a shell would interpret.
function normalizeManagedSshDestination(
  payload: Record<string, unknown>,
  operationId: string,
): { host: string; username: string | null } {
  const host = normalizeRequiredString(payload.host, `${operationId} host`)
  const username = normalizeOptionalString(payload.username)
  const problem = findManagedSshHostProblem(host) ?? findManagedSshUsernameProblem(username)
  if (problem) {
    throw createAppError('common.invalid_input', { debugMessage: `${operationId}: ${problem}` })
  }
  return { host, username }
}

export function normalizeRegisterManagedSshEndpointPayload(
  payload: unknown,
): RegisterManagedSshWorkerEndpointInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for endpoint.registerManagedSsh.',
    })
  }

  const remotePlatform =
    payload.remotePlatform === 'posix' || payload.remotePlatform === 'windows'
      ? payload.remotePlatform
      : 'auto'

  return {
    displayName: normalizeOptionalString(payload.displayName),
    ...normalizeManagedSshDestination(payload, 'endpoint.registerManagedSsh'),
    port: normalizeOptionalManagedSshPort(payload.port, 'endpoint.registerManagedSsh port'),
    remotePort: normalizeOptionalManagedSshPort(
      payload.remotePort,
      'endpoint.registerManagedSsh remotePort',
    ),
    remotePlatform,
  }
}

export function normalizeUpdateManagedSshEndpointPayload(
  payload: unknown,
): UpdateManagedSshWorkerEndpointInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for endpoint.updateManagedSsh.',
    })
  }

  const remotePort = normalizeOptionalManagedSshPort(
    payload.remotePort,
    'endpoint.updateManagedSsh remotePort',
  )
  if (remotePort === null) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Missing endpoint.updateManagedSsh remotePort.',
    })
  }

  const remotePlatform =
    payload.remotePlatform === 'posix' || payload.remotePlatform === 'windows'
      ? payload.remotePlatform
      : 'auto'

  return {
    endpointId: normalizeRequiredString(payload.endpointId, 'endpoint.updateManagedSsh endpointId'),
    displayName: normalizeOptionalString(payload.displayName),
    ...normalizeManagedSshDestination(payload, 'endpoint.updateManagedSsh'),
    port: normalizeOptionalManagedSshPort(payload.port, 'endpoint.updateManagedSsh port'),
    remotePort,
    remotePlatform,
  }
}

export function normalizeTargetBuild(value: unknown) {
  if (value === undefined || value === null) {
    return undefined
  }
  const build = parseRuntimeBuildIdentity(value)
  if (!build) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid runtime build descriptor.',
    })
  }
  return build
}

export function normalizePrepareEndpointPayload(payload: unknown): PrepareWorkerEndpointInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for endpoint.prepare.',
    })
  }

  const reason =
    payload.reason === 'connect' || payload.reason === 'browse' || payload.reason === 'reconnect'
      ? payload.reason
      : null

  return {
    endpointId: normalizeRequiredString(payload.endpointId, 'endpoint.prepare endpointId'),
    ...(payload.runtimeBuild ? { runtimeBuild: normalizeTargetBuild(payload.runtimeBuild) } : {}),
    ...(reason ? { reason } : {}),
  }
}

export function normalizeRepairEndpointPayload(payload: unknown): RepairWorkerEndpointInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for endpoint.repair.',
    })
  }

  const action = payload.action
  if (
    action !== 'repair_credentials' &&
    action !== 'repair_tunnel' &&
    action !== 'install_runtime' &&
    action !== 'update_runtime' &&
    action !== 'retry'
  ) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid endpoint.repair action.',
    })
  }

  return {
    endpointId: normalizeRequiredString(payload.endpointId, 'endpoint.repair endpointId'),
    ...(payload.runtimeBuild ? { runtimeBuild: normalizeTargetBuild(payload.runtimeBuild) } : {}),
    action,
  }
}
