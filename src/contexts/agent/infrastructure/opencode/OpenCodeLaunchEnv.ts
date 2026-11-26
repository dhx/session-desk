import type { CreateAgentLaunchPlanCommand } from '../../application/ports/AgentProviderContribution'
import type { AgentLaunchArtifactRoot } from '../providers/shared/AgentLaunchArtifactFile'
import { createOpenCodeEmbeddedTuiConfig } from './OpenCodeTuiConfig'

/**
 * OpenCode's launch environment: an embedded TUI config, unless the user set their own with
 * OPENCODE_TUI_CONFIG. The generic catalog provider looks this up by provider id.
 */
export async function createOpenCodeLaunchEnv(
  command: CreateAgentLaunchPlanCommand,
  artifactRoot: AgentLaunchArtifactRoot,
): Promise<Record<string, string>> {
  if (process.env.OPENCODE_TUI_CONFIG?.trim()) {
    return {}
  }
  const tuiConfig = command.artifacts.track(
    'opencode-tui-config',
    await createOpenCodeEmbeddedTuiConfig(artifactRoot),
  )
  return { OPENCODE_TUI_CONFIG: tuiConfig.path }
}
