import { describe, expect, it } from 'vitest'
import {
  areLaunchOverridesAllowed,
  resolveAgentFullAccessPolicy,
  resolveEffectiveAgentFullAccess,
  type AgentFullAccessPolicy,
} from '../../../src/contexts/agent/application/agentLaunchPolicy'
import {
  resolveLocalAgentLaunchSecurity,
  resolveTransportLaunchOverrides,
} from '../../../src/app/main/controlSurface/handlers/agentLaunchOverrides'
import { DEFAULT_AGENT_SETTINGS } from '../../../src/contexts/settings/domain/agentSettings'

describe('agent full access policy', () => {
  it('defaults the setting to off', () => {
    expect(DEFAULT_AGENT_SETTINGS.agentFullAccess).toBe(false)
  })

  it.each([
    [undefined, 'setting'],
    ['', 'setting'],
    ['setting', 'setting'],
    [' Allow ', 'allow'],
    ['deny', 'deny'],
    ['DENY', 'deny'],
    ['yes-please', 'deny'],
  ] as const)('reads OPENCOVE_AGENT_FULL_ACCESS=%j as %s', (raw, expected) => {
    expect(resolveAgentFullAccessPolicy({ OPENCOVE_AGENT_FULL_ACCESS: raw })).toBe(expected)
  })

  // [policy, setting, requested by payload, effective]
  const matrix: Array<[AgentFullAccessPolicy, boolean, boolean | null, boolean]> = [
    ['deny', false, null, false],
    ['deny', false, false, false],
    ['deny', false, true, false],
    ['deny', true, null, false],
    ['deny', true, false, false],
    ['deny', true, true, false],
    ['setting', false, null, false],
    ['setting', false, false, false],
    ['setting', false, true, false],
    ['setting', true, null, true],
    ['setting', true, false, false],
    ['setting', true, true, true],
    ['allow', false, null, false],
    ['allow', false, false, false],
    ['allow', false, true, true],
    ['allow', true, null, true],
    ['allow', true, false, false],
    ['allow', true, true, true],
  ]

  it.each(matrix)(
    'policy %s, setting %s, payload %s -> full access %s',
    (policy, setting, requested, expected) => {
      expect(resolveEffectiveAgentFullAccess({ policy, setting, requested })).toBe(expected)
    },
  )
})

describe('launch overrides from transport payloads', () => {
  it.each([
    [undefined, false],
    ['0', false],
    ['yes', false],
    ['1', true],
    ['true', true],
  ] as const)('OPENCOVE_ALLOW_LAUNCH_OVERRIDES=%j -> allowed %s', (raw, expected) => {
    expect(areLaunchOverridesAllowed({ OPENCOVE_ALLOW_LAUNCH_OVERRIDES: raw })).toBe(expected)
  })

  it('drops the executable override and env entries the user did not configure', () => {
    const result = resolveTransportLaunchOverrides({
      policyEnv: {},
      requestedExecutablePathOverride: '/tmp/evil',
      requestedEnv: {
        FROM_SETTINGS: 'a',
        FROM_PROJECT: 'b',
        LD_PRELOAD: '/tmp/evil.so',
        FROM_SETTINGS_CHANGED: 'tampered',
      },
      trustedEnvs: [
        { FROM_SETTINGS: 'a', FROM_SETTINGS_CHANGED: 'original' },
        { FROM_PROJECT: 'b' },
      ],
    })

    expect(result).toEqual({
      executablePathOverride: null,
      env: { FROM_SETTINGS: 'a', FROM_PROJECT: 'b' },
      ignoredExecutablePathOverride: true,
      ignoredEnvKeys: ['LD_PRELOAD', 'FROM_SETTINGS_CHANGED'],
    })
  })

  it('passes everything through when OPENCOVE_ALLOW_LAUNCH_OVERRIDES=1', () => {
    const result = resolveTransportLaunchOverrides({
      policyEnv: { OPENCOVE_ALLOW_LAUNCH_OVERRIDES: '1' },
      requestedExecutablePathOverride: '/opt/custom/codex',
      requestedEnv: { ANYTHING: 'x' },
      trustedEnvs: [],
    })

    expect(result).toEqual({
      executablePathOverride: '/opt/custom/codex',
      env: { ANYTHING: 'x' },
      ignoredExecutablePathOverride: false,
      ignoredEnvKeys: [],
    })
  })
})

// Upstream #612 lets a launch (CLI --full-access, node.create data.agentFullAccess, plugin
// agents.launch, also from agent terminals) ask for Full Access. In this fork the request only
// counts as far as OPENCOVE_AGENT_FULL_ACCESS lets it.
describe('per-launch Full Access requests', () => {
  const launch = (policy: string | undefined, setting: boolean, requested: boolean) =>
    resolveLocalAgentLaunchSecurity({
      payload: { agentFullAccess: requested },
      agentSettings: { ...DEFAULT_AGENT_SETTINGS, agentFullAccess: setting },
      state: null,
      provider: 'claude-code',
      policyEnv: { OPENCOVE_AGENT_FULL_ACCESS: policy },
    }).agentFullAccess

  it('cannot turn Full Access on under the default policy', () => {
    expect(launch(undefined, false, true)).toBe(false)
    expect(launch('setting', false, true)).toBe(false)
  })

  it('can always turn it off', () => {
    expect(launch(undefined, true, false)).toBe(false)
    expect(launch('allow', true, false)).toBe(false)
  })

  it('turns it on only when the operator allows launch requests to', () => {
    expect(launch('allow', false, true)).toBe(true)
    expect(launch('deny', true, true)).toBe(false)
  })
})
