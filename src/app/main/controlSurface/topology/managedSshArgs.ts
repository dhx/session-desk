import type { ManagedSshEndpointRuntimeAccess } from './topologyEndpointAccess'
import {
  findManagedSshHostProblem,
  findManagedSshUsernameProblem,
} from '../../../../shared/contracts/managedSshDestination'

function destination(access: ManagedSshEndpointRuntimeAccess): string {
  const username = access.ssh.username?.trim() || null
  const problem =
    findManagedSshHostProblem(access.ssh.host) ?? findManagedSshUsernameProblem(username)
  if (problem) {
    throw new Error(`Refusing to run ssh: ${problem}`)
  }
  return username ? `${username}@${access.ssh.host}` : access.ssh.host
}

function options(access: ManagedSshEndpointRuntimeAccess): string[] {
  return [
    ...(access.ssh.port ? ['-p', String(access.ssh.port)] : []),
    ...(access.ssh.host.trim().toLowerCase() === 'localhost' ? ['-o', 'AddressFamily=inet'] : []),
  ]
}

export function buildSshArgs(access: ManagedSshEndpointRuntimeAccess, command: string[]): string[] {
  // `--` ends option parsing, so the destination can never be read as an ssh option.
  return [...options(access), '--', destination(access), ...command]
}

export function buildSshTunnelArgs(
  access: ManagedSshEndpointRuntimeAccess,
  tunnel: string[],
): string[] {
  return [...options(access), ...tunnel, '--', destination(access)]
}
