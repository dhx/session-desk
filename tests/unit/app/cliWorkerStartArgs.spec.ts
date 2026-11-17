import { describe, expect, it } from 'vitest'
import { buildWorkerStartForwarding } from '../../../src/app/cli/commands/workerStartArgs'

describe('worker start forwarding', () => {
  it('keeps secrets off the worker command line', () => {
    const { args, secretEnv } = buildWorkerStartForwarding({
      token: 'tok',
      'web-ui-password': 'pw',
      'web-ui-password-hash': 'hash',
      hostname: '0.0.0.0',
    })
    expect(args).toEqual(['--hostname=0.0.0.0'])
    expect(args.join(' ')).not.toMatch(/tok|pw|hash/)
    expect(secretEnv).toEqual({
      OPENCOVE_WORKER_TOKEN: 'tok',
      OPENCOVE_WEB_UI_PASSWORD: 'pw',
      OPENCOVE_WEB_UI_PASSWORD_HASH: 'hash',
    })
  })

  it('forwards file paths, repeated roots and boolean flags', () => {
    const { args, secretEnv } = buildWorkerStartForwarding({
      'token-file': '/run/secrets/token',
      'web-ui-password-file': '/run/secrets/pw',
      'approve-root': ['/srv/a', '/srv/b'],
      'allow-insecure-bind': true,
      'allow-query-token': false,
    })
    expect(args).toEqual([
      '--token-file=/run/secrets/token',
      '--web-ui-password-file=/run/secrets/pw',
      '--approve-root=/srv/a',
      '--approve-root=/srv/b',
      '--allow-insecure-bind',
    ])
    expect(secretEnv).toEqual({})
  })
})
