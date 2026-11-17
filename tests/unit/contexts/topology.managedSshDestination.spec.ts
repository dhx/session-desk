import { describe, expect, it } from 'vitest'
import {
  findManagedSshHostProblem,
  findManagedSshUsernameProblem,
} from '../../../src/shared/contracts/managedSshDestination'
import {
  normalizeRegisterManagedSshEndpointPayload,
  normalizeUpdateManagedSshEndpointPayload,
} from '../../../src/shared/contracts/controlSurface/operations/managedSshNormalize'
import { normalizeTopologyFile } from '../../../src/app/main/controlSurface/topology/topologyFileV1'

describe('managed SSH destination validation', () => {
  it.each([
    '-oProxyCommand=touch /tmp/x',
    '-p',
    'example.com x',
    'exa\tmple',
    'host\u0000',
    'h\u007f',
  ])('rejects host %j', host => {
    expect(findManagedSshHostProblem(host)).not.toBeNull()
  })

  it.each(['example.com', 'my-ssh-alias', '10.0.0.1', '[::1]', 'host-with-dash-'])(
    'accepts host %j',
    host => {
      expect(findManagedSshHostProblem(host)).toBeNull()
    },
  )

  it.each(['-oProxyCommand=x', 'bad user', 'tab\tuser', 'nl\n'])('rejects user %j', user => {
    expect(findManagedSshUsernameProblem(user)).not.toBeNull()
  })

  it.each([null, 'ubuntu', 'first.last', 'svc-deploy'])('accepts user %j', user => {
    expect(findManagedSshUsernameProblem(user)).toBeNull()
  })

  it('rejects unsafe values in register and update payloads', () => {
    expect(() =>
      normalizeRegisterManagedSshEndpointPayload({ host: '-oProxyCommand=id', remotePort: 1 }),
    ).toThrow()
    expect(() =>
      normalizeRegisterManagedSshEndpointPayload({
        host: 'example.com',
        username: '-oProxyCommand=id',
      }),
    ).toThrow()
    expect(() =>
      normalizeUpdateManagedSshEndpointPayload({
        endpointId: 'e1',
        host: 'example.com evil',
        remotePort: 39291,
      }),
    ).toThrow()
    expect(
      normalizeRegisterManagedSshEndpointPayload({ host: 'example.com', username: 'ubuntu' }),
    ).toMatchObject({ host: 'example.com', username: 'ubuntu' })
  })

  it('drops unsafe managed SSH settings from a stored topology file', () => {
    const endpoint = (host: string) => ({
      endpointId: `e-${host.length}`,
      kind: 'remote_worker',
      displayName: 'Box',
      hostname: '127.0.0.1',
      port: 41000,
      accessKind: 'managed_ssh',
      managedSsh: { host, port: 22, username: 'ubuntu', remotePort: 39291 },
    })
    const file = normalizeTopologyFile({
      version: 1,
      endpoints: [endpoint('-oProxyCommand=id'), endpoint('example.com')],
      mounts: [],
    })

    const managed = file.endpoints.map(entry => entry.managedSsh?.host ?? null)
    expect(managed).toContain('example.com')
    expect(managed).not.toContain('-oProxyCommand=id')
  })
})
