import { Flags } from '@oclif/core';

import Log from '../../log';
import EasCommand from '../../commandUtils/EasCommand';
import { ora } from '../../ora';
import { EasNonInteractiveAndJsonFlags } from '../../commandUtils/flags';
import { assignWorkerDeploymentAliasAsync, selectWorkerDeploymentOnAppAsync } from '../../worker/deployment';
import chalk from 'chalk';
import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';

export default class WorkerAlias extends EasCommand {
  static override description = 'Inspect or modify deployment alias';
  static override aliases = ['deploy:alias'];

  // TODO(@kitten): Keep command hidden until worker deployments are live
  static override hidden = true;
  static override state = 'beta';

  static override flags = {
    id: Flags.string({
      description: 'Expo deployment ID',
      required: false,
    }),
    alias: Flags.string({
      description: 'Deployment alias',
      required: false,
    }),
    ...EasNonInteractiveAndJsonFlags,
  };

  static override contextDefinition = {
    ...this.ContextOptions.DynamicProjectConfig,
    ...this.ContextOptions.ProjectDir,
    ...this.ContextOptions.LoggedIn,
  };

  override async runAsync() {
    Log.warn('EAS Worker Deployments are in beta and subject to breaking changes.');

    const { flags } = await this.parse(WorkerAlias);
    const {
      getDynamicPrivateProjectConfigAsync,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(WorkerAlias, {
      nonInteractive: true,
    });

    // If `--id` is not defined, fetch the deployment IDs as list
    //   - If non-interactive mode is enabled, abort after this
    //   - If `--json` is provided, return the data as json
    // If `--alias` is not defined, fetch the alias of the deployment ID
    //   - If `--alias` is defined, update the alias of the deployment ID

    const { projectId } = await getDynamicPrivateProjectConfigAsync();

    if (!flags.alias) throw new Error('Please provide an alias');

    // resolve alias first
    const deploymentId = await resolveDeploymentIdAsync({
      graphqlClient,
      aliasName: flags.alias,
      appId: projectId,
      flagId: flags.id,
    });

    const progress = ora('Assigning alias to worker deployment').start();
    const workerAlias = await assignWorkerDeploymentAliasAsync({
      graphqlClient,
      appId: projectId,
      deploymentId,
      aliasName: flags.alias,
    });

    progress.succeed(chalk`Alias {bold ${workerAlias.aliasName}} assigned to deployment {bold ${deploymentId}}`);

    const baseDomain = process.env.EXPO_STAGING ? 'staging.expo' : 'expo';
    const aliasUrl = `https://${baseDomain}.dev/projects/${projectId}/serverless/deployments`;

    Log.addNewLineIfNone();
    Log.log(`🎉 Your deployment is now available on: ${workerAlias.url}`);
    Log.addNewLineIfNone();
    Log.log(`🔗 Manage on EAS: ${aliasUrl}`);
  }
}

async function resolveDeploymentIdAsync({
  graphqlClient,
  aliasName,
  appId,
  flagId,
}: {
  graphqlClient: ExpoGraphqlClient;
  aliasName: string;
  appId: string;
  flagId?: string;
}) {
  if (flagId) {
    return flagId;
  }

  const deployment = await selectWorkerDeploymentOnAppAsync({
    graphqlClient, appId,
    selectTitle: chalk`deployment to assign the {underline ${aliasName}} alias`
  });

  return deployment?.deploymentIdentifier as string;
}
