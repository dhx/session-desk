import { readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentLaunchArtifactScope } from '../../../src/contexts/agent/application/services/AgentLaunchArtifactScope'
import {
  createAgentLaunchArtifactRoot,
  createBuiltinAgentProviderContributions,
} from '../../../src/contexts/agent/infrastructure/providers/catalog/BuiltinAgentProviderCatalog'

afterEach(() => {
  vi.unstubAllEnvs()
})

// Upstream #737 keeps launch artifacts under userData/runtime/agent-launch instead of the OS temp dir.
const userData = join(tmpdir(), 'opencode-tui-config-spec')
const launchRoot = join(userData, 'runtime', 'agent-launch')

function openCodeContribution() {
  const contribution = createBuiltinAgentProviderContributions({
    artifactRoot: createAgentLaunchArtifactRoot(userData),
  }).find(entry => entry.descriptor.id === 'opencode')
  if (!contribution) {
    throw new Error('missing opencode contribution')
  }
  return contribution
}

async function createPlan(artifacts: AgentLaunchArtifactScope) {
  return await openCodeContribution().launcher.createLaunchPlan({
    agentFullAccess: false,
    artifacts,
    mode: 'new',
    model: null,
    opencodeServer: { hostname: '127.0.0.1', port: 4096 },
    prompt: '',
    resumeSessionId: null,
    workspaceDirectory: '/repo',
  })
}

describe('OpenCode embedded TUI config', () => {
  it('writes a private per-launch file and removes it with the launch artifacts', async () => {
    vi.stubEnv('OPENCODE_TUI_CONFIG', '')
    const artifacts = new AgentLaunchArtifactScope()
    const plan = await createPlan(artifacts)
    artifacts.seal()

    const path = plan.env.OPENCODE_TUI_CONFIG
    expect(path).toBeTypeOf('string')
    expect(path).not.toBe(join(tmpdir(), 'opencove-opencode-tui.embedded.json'))
    expect(dirname(dirname(path!))).toBe(launchRoot)
    expect(JSON.parse(await readFile(path!, 'utf8'))).toMatchObject({ theme: 'system' })
    if (process.platform !== 'win32') {
      expect((await stat(path!)).mode & 0o777).toBe(0o600)
      expect((await stat(dirname(path!))).mode & 0o777).toBe(0o700)
    }

    const second = new AgentLaunchArtifactScope()
    const secondPlan = await createPlan(second)
    expect(secondPlan.env.OPENCODE_TUI_CONFIG).not.toBe(path)
    await second.dispose()

    await artifacts.dispose()
    await expect(stat(dirname(path!))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it("keeps the user's own OPENCODE_TUI_CONFIG and writes nothing", async () => {
    vi.stubEnv('OPENCODE_TUI_CONFIG', '/home/alice/.config/opencode/tui.json')
    const artifacts = new AgentLaunchArtifactScope()
    const plan = await createPlan(artifacts)

    expect(plan.env).not.toHaveProperty('OPENCODE_TUI_CONFIG')
    await artifacts.dispose()
  })
})
