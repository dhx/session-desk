// A host or user that starts with '-' would be parsed by ssh as an option (for example
// `-oProxyCommand=...`, which runs a local command). Whitespace and control characters have no
// place in either value and could split or smuggle arguments.
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const UNSAFE_SSH_DESTINATION_CHARACTERS = /[\s\u0000-\u001f\u007f]/u

export function findManagedSshHostProblem(host: string): string | null {
  if (host.length === 0) {
    return 'SSH host is empty.'
  }
  if (host.startsWith('-')) {
    return 'SSH host must not start with "-".'
  }
  if (UNSAFE_SSH_DESTINATION_CHARACTERS.test(host)) {
    return 'SSH host must not contain spaces or control characters.'
  }
  return null
}

export function findManagedSshUsernameProblem(username: string | null): string | null {
  if (username === null || username.length === 0) {
    return null
  }
  if (username.startsWith('-')) {
    return 'SSH user must not start with "-".'
  }
  if (UNSAFE_SSH_DESTINATION_CHARACTERS.test(username)) {
    return 'SSH user must not contain spaces or control characters.'
  }
  return null
}

export function isSafeManagedSshDestination(host: string, username: string | null): boolean {
  return (
    findManagedSshHostProblem(host) === null && findManagedSshUsernameProblem(username) === null
  )
}
