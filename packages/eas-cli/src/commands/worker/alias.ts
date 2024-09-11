import { Flags } from '@oclif/core';

import Log from '../../log';
import EasCommand from '../../commandUtils/EasCommand';
import { ora } from '../../ora';
import {
  assignWorkerDeploymentAliasAsync,
  selectWorkerDeploymentOnAppAsync,
} from '../../worker/deployment';
import chalk from 'chalk';
import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { promptAsync } from '../../prompts';

export default class WorkerAlias extends EasCommand {
  static override description = 'Assign deployment aliases';
  static override aliases = ['deploy:alias'];

  // TODO(@kitten): Keep command hidden until worker deployments are live
  static override hidden = true;
  static override state = 'beta';

  static override flags = {
    id: Flags.string({
      description: 'Worker deployment identifier',
      required: false,
    }),
    alias: Flags.string({
      description: 'Worker deployment alias name to assign',
      required: false,
    }),
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

    const { projectId } = await getDynamicPrivateProjectConfigAsync();
    const aliasName = await resolveDeploymentAliasAsync({ flagAlias: flags.alias });
    const deploymentId = await resolveDeploymentIdAsync({
      graphqlClient,
      aliasName,
      appId: projectId,
      flagId: flags.id,
    });

    const progress = ora('Assigning alias to worker deployment').start();
    const workerAlias = await assignWorkerDeploymentAliasAsync({
      graphqlClient,
      appId: projectId,
      deploymentId,
      aliasName,
    });

    progress.succeed(
      chalk`Alias {bold ${workerAlias.aliasName}} assigned to deployment {bold ${deploymentId}}`
    );

    const baseDomain = process.env.EXPO_STAGING ? 'staging.expo' : 'expo';
    const aliasUrl = `https://${baseDomain}.dev/projects/${projectId}/serverless/deployments`;

    Log.addNewLineIfNone();
    Log.log(`🎉 Your deployment is now available on: ${workerAlias.url}`);
    Log.addNewLineIfNone();
    Log.log(`🔗 Manage on EAS: ${aliasUrl}`);
  }
}

async function resolveDeploymentAliasAsync({ flagAlias }: { flagAlias?: string }): Promise<string> {
  if (flagAlias?.trim()) {
    return flagAlias.trim().toLowerCase();
  }

  const { alias: aliasName } = await promptAsync({
    type: 'text',
    name: 'alias',
    message: 'Enter the alias to assign to a deployment',
    validate: (value: string) => !!value.trim(),
    hint: 'The alias name is case insensitive and must be URL safe',
  });

  return aliasName.trim().toLowerCase();
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
  if (flagId) return flagId;

  const deployment = await selectWorkerDeploymentOnAppAsync({
    graphqlClient,
    appId,
    selectTitle: chalk`deployment to assign the {underline ${aliasName}} alias`,
  });

  return deployment?.deploymentIdentifier as string;
}
