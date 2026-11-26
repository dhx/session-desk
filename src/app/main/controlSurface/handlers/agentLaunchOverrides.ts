import {
  areLaunchOverridesAllowed,
  resolveAgentFullAccessPolicy,
  resolveEffectiveAgentFullAccess,
} from '../../../../contexts/agent/application'
import {
  normalizeAgentSettings,
  resolveAgentExecutablePathOverride,
  resolveAgentLaunchEnv,
} from '../../../../contexts/settings/domain'
import {
  normalizePersistedAppState,
  type NormalizedPersistedAppState,
} from '../../../../platform/persistence/sqlite/normalize'
import {
  AGENT_PROVIDER_IDS,
  type AgentLaunchMode,
  type AgentProviderId,
  type LaunchAgentSessionInMountInput,
  type LaunchAgentSessionInput,
} from '../../../../shared/contracts/dto'

export interface TransportLaunchOverrides {
  /** `null` means "use the executable from the settings". */
  executablePathOverride: string | null
  env: Record<string, string> | null
  ignoredExecutablePathOverride: boolean
  ignoredEnvKeys: string[]
}

/**
 * Launch payloads arrive over the control surface (`/invoke`) and may come from any authenticated
 * caller. Unless `OPENCOVE_ALLOW_LAUNCH_OVERRIDES=1`, they cannot choose the binary to run, and
 * they can only pass environment entries that the user already configured on this machine (agent
 * env in the settings, or a project's environment variables). The renderer computes its launch env
 * from exactly that persisted state, so the UI keeps working.
 */
export function resolveTransportLaunchOverrides(input: {
  policyEnv: Readonly<Record<string, string | undefined>>
  requestedExecutablePathOverride: string | null | undefined
  requestedEnv: Record<string, string> | null | undefined
  trustedEnvs: readonly Readonly<Record<string, string>>[]
}): TransportLaunchOverrides {
  const requestedExecutablePathOverride = input.requestedExecutablePathOverride ?? null
  const requestedEnv = input.requestedEnv ?? null

  if (areLaunchOverridesAllowed(input.policyEnv)) {
    return {
      executablePathOverride: requestedExecutablePathOverride,
      env: requestedEnv,
      ignoredExecutablePathOverride: false,
      ignoredEnvKeys: [],
    }
  }

  if (!requestedEnv) {
    return {
      executablePathOverride: null,
      env: null,
      ignoredExecutablePathOverride: requestedExecutablePathOverride !== null,
      ignoredEnvKeys: [],
    }
  }

  const env: Record<string, string> = {}
  const ignoredEnvKeys: string[] = []
  for (const [key, value] of Object.entries(requestedEnv)) {
    const trusted = input.trustedEnvs.some(
      candidate => Object.hasOwn(candidate, key) && candidate[key] === value,
    )
    if (trusted) {
      env[key] = value
    } else {
      ignoredEnvKeys.push(key)
    }
  }

  return {
    executablePathOverride: null,
    env: Object.keys(env).length > 0 ? env : null,
    ignoredExecutablePathOverride: requestedExecutablePathOverride !== null,
    ignoredEnvKeys,
  }
}

export function collectTrustedLaunchEnvs(
  state: NormalizedPersistedAppState | null,
  provider: AgentProviderId | null,
): Record<string, string>[] {
  const settings = normalizeAgentSettings(state?.settings)
  const providers = provider ? [provider] : AGENT_PROVIDER_IDS
  return [
    ...providers.map(candidate => resolveAgentLaunchEnv(settings, candidate)),
    ...(state?.workspaces ?? []).map(workspace => workspace.environmentVariables),
  ]
}

/**
 * Resolves the security-relevant parts of a local agent launch from the payload, the user's
 * settings and the process environment: full access (OPENCOVE_AGENT_FULL_ACCESS), the executable
 * and the extra env (OPENCOVE_ALLOW_LAUNCH_OVERRIDES).
 */
export function resolveLocalAgentLaunchSecurity(input: {
  payload: {
    agentFullAccess?: boolean | null
    executablePathOverride?: string | null
    env?: Record<string, string> | null
    codexReuseRunningAppServer?: boolean | null
  }
  agentSettings: ReturnType<typeof normalizeAgentSettings>
  state: NormalizedPersistedAppState | null
  provider: AgentProviderId
  policyEnv?: Readonly<Record<string, string | undefined>>
}): {
  agentFullAccess: boolean
  executablePathOverride: string | null
  env: Record<string, string> | null
  codexReuseRunningAppServer: boolean
  diagnostics: { ignoredExecutablePathOverride: boolean; ignoredEnvKeyCount: number }
} {
  const policyEnv = input.policyEnv ?? process.env
  const overrides = resolveTransportLaunchOverrides({
    policyEnv,
    requestedExecutablePathOverride: input.payload.executablePathOverride,
    requestedEnv: input.payload.env,
    trustedEnvs: collectTrustedLaunchEnvs(input.state, input.provider),
  })
  return {
    agentFullAccess: resolveEffectiveAgentFullAccess({
      policy: resolveAgentFullAccessPolicy(policyEnv),
      setting: input.agentSettings.agentFullAccess,
      requested: input.payload.agentFullAccess,
    }),
    executablePathOverride:
      overrides.executablePathOverride ??
      resolveAgentExecutablePathOverride(input.agentSettings, input.provider),
    env: overrides.env,
    codexReuseRunningAppServer:
      input.payload.codexReuseRunningAppServer ?? input.agentSettings.codexReuseRunningAppServer,
    diagnostics: {
      ignoredExecutablePathOverride: overrides.ignoredExecutablePathOverride,
      ignoredEnvKeyCount: overrides.ignoredEnvKeys.length,
    },
  }
}

/**
 * Payload for `session.launchAgent` on a remote worker. The remote worker applies its own policy
 * too; filtering here stops a caller of the home worker from using it as a relay for overrides it
 * could not set on the home worker.
 */
export function buildForwardedLaunchAgentPayload(input: {
  payload: LaunchAgentSessionInMountInput
  cwd: string
  mode: AgentLaunchMode
  state: NormalizedPersistedAppState | null
  policyEnv?: Readonly<Record<string, string | undefined>>
}): LaunchAgentSessionInput {
  const { payload } = input
  const overrides = resolveTransportLaunchOverrides({
    policyEnv: input.policyEnv ?? process.env,
    requestedExecutablePathOverride: payload.executablePathOverride,
    requestedEnv: payload.env,
    trustedEnvs: collectTrustedLaunchEnvs(input.state, payload.provider ?? null),
  })
  return {
    cwd: input.cwd,
    prompt: payload.prompt,
    provider: payload.provider ?? null,
    mode: input.mode,
    model: payload.model ?? null,
    resumeSessionId: payload.resumeSessionId ?? null,
    env: overrides.env,
    executablePathOverride: overrides.executablePathOverride,
    agentFullAccess: payload.agentFullAccess ?? null,
    codexReuseRunningAppServer: payload.codexReuseRunningAppServer ?? null,
    cols: payload.cols,
    rows: payload.rows,
  }
}

/** buildForwardedLaunchAgentPayload against the saved state (trusted per-project envs). */
export async function forwardLaunchAgentPayload(
  input: Omit<Parameters<typeof buildForwardedLaunchAgentPayload>[0], 'state'> & {
    getPersistenceStore: () => Promise<{ readAppState: () => Promise<unknown> }>
  },
): Promise<LaunchAgentSessionInput> {
  const { getPersistenceStore, ...rest } = input
  // The saved state only tells which requested env is trusted; skip the read when nothing asks.
  const requestedEnv = rest.payload.env ? Object.keys(rest.payload.env).length > 0 : false
  const state =
    requestedEnv && !areLaunchOverridesAllowed(process.env)
      ? normalizePersistedAppState(await (await getPersistenceStore()).readAppState())
      : null
  return buildForwardedLaunchAgentPayload({ ...rest, state })
}
