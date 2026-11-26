import type {
  AgentLaunchPlan,
  AgentProviderDescriptor,
  AgentProviderDetector,
  CreateAgentLaunchPlanCommand,
} from '../../../application/ports/AgentProviderContribution'
import {
  buildAgentLaunchCommand,
  type BuiltinAgentCommandProviderId,
} from '../../cli/AgentCommandFactory'
import { TerminalCliAgentProviderContribution } from '../terminal-cli/TerminalCliContribution'
import type { AgentLaunchArtifactRoot } from '../shared/AgentLaunchArtifactFile'

/** Extra environment a catalog provider adds to its launch, registered per provider id. */
export type CatalogLaunchEnv = (
  command: CreateAgentLaunchPlanCommand,
  artifactRoot: AgentLaunchArtifactRoot,
) => Promise<Record<string, string>>

export class CatalogTerminalCliProvider extends TerminalCliAgentProviderContribution {
  readonly descriptor: AgentProviderDescriptor & { readonly id: BuiltinAgentCommandProviderId }
  private readonly artifactRoot: AgentLaunchArtifactRoot
  private readonly launchEnv: CatalogLaunchEnv | undefined

  constructor(
    descriptor: AgentProviderDescriptor & { readonly id: BuiltinAgentCommandProviderId },
    options: {
      readonly artifactRoot: AgentLaunchArtifactRoot
      readonly detector?: AgentProviderDetector
      readonly launchEnv?: CatalogLaunchEnv
    },
  ) {
    super(descriptor.id, descriptor.launch.executable, options)
    this.descriptor = descriptor
    this.artifactRoot = options.artifactRoot
    this.launchEnv = options.launchEnv
  }

  protected override async createTerminalLaunchPlan(
    command: CreateAgentLaunchPlanCommand,
  ): Promise<AgentLaunchPlan> {
    const plan = buildAgentLaunchCommand({
      provider: this.descriptor.id,
      mode: command.mode,
      prompt: command.prompt,
      model: command.model,
      resumeSessionId: command.resumeSessionId,
      agentFullAccess: command.agentFullAccess,
      opencodeServer: command.opencodeServer,
    })
    const env = this.launchEnv ? await this.launchEnv(command, this.artifactRoot) : {}
    return { ...plan, env }
  }
}
