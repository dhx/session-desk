import {
  createAgentLaunchArtifactFile,
  type AgentLaunchArtifactFile,
  type AgentLaunchArtifactRoot,
} from '../providers/shared/AgentLaunchArtifactFile'

export const OPENCODE_EMBEDDED_TUI_CONFIG_CONTENTS = `${JSON.stringify(
  {
    $schema: 'https://opencode.ai/tui.json',
    theme: 'system',
  },
  null,
  2,
)}\n`

/**
 * Writes the embedded OpenCode TUI config into a fresh private launch directory (0700, file 0600)
 * instead of a fixed, guessable path in the shared temp dir. The caller owns the returned artifact
 * and disposes it with the launch, like the other agent launch artifacts.
 */
export async function createOpenCodeEmbeddedTuiConfig(
  root: AgentLaunchArtifactRoot,
): Promise<AgentLaunchArtifactFile> {
  return await createAgentLaunchArtifactFile(
    root,
    'opencove-opencode-tui-',
    'tui.json',
    OPENCODE_EMBEDDED_TUI_CONFIG_CONTENTS,
  )
}
