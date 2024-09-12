import { Flags } from '@oclif/core';
import chalk from 'chalk';

import EasCommand from '../../commandUtils/EasCommand';
import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import Log from '../../log';
import { ora } from '../../ora';
import { promptAsync } from '../../prompts';
import formatFields from '../../utils/formatFields';
import {
  assignWorkerDeploymentAliasAsync,
  selectWorkerDeploymentOnAppAsync,
} from '../../worker/deployment';

export default class WorkerAlias extends EasCommand {
  static override description = 'Assign deployment aliases';
  static override aliases = ['deploy:alias'];

  // TODO(@kitten): Keep command hidden until worker deployments are live
  static override hidden = true;
  static override state = 'beta';

  static override flags = {
    alias: Flags.string({
      description: 'Custom alias to assign to the existing deployment',
      helpValue: 'name',
      required: false,
    }),
    id: Flags.string({
      description: 'Unique identifier of an existing deployment',
      helpValue: 'xyz123',
      required: false,
    }),
  };

  static override contextDefinition = {
    ...this.ContextOptions.DynamicProjectConfig,
    ...this.ContextOptions.ProjectDir,
    ...this.ContextOptions.LoggedIn,
  };

  override async runAsync(): Promise<void> {
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

    const progress = ora(
      chalk`Assigning alias {bold ${aliasName}} to deployment {bold ${deploymentId}}`
    ).start();
    const workerAlias = await assignWorkerDeploymentAliasAsync({
      graphqlClient,
      appId: projectId,
      deploymentId,
      aliasName,
    }).catch(error => {
      progress.fail(
        chalk`Failed to assign {bold ${aliasName}} alias to deployment {bold ${deploymentId}}`
      );
      throw error;
    });

    progress.succeed(
      chalk`Assigned alias {bold ${aliasName}} to deployment {bold ${deploymentId}}`
    );

    const expoBaseDomain = process.env.EXPO_STAGING ? 'staging.expo' : 'expo';
    const expoDashboardUrl = `https://${expoBaseDomain}.dev/projects/${projectId}/serverless/deployments`;

    Log.addNewLineIfNone();
    Log.log(
      formatFields([
        { label: 'Dashboard', value: expoDashboardUrl },
        { label: 'Aliased URL', value: chalk.cyan(workerAlias.url) },
      ])
    );
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
}): Promise<string> {
  if (flagId) {
    return flagId;
  }

  const deployment = await selectWorkerDeploymentOnAppAsync({
    graphqlClient,
    appId,
    selectTitle: chalk`deployment to assign the {underline ${aliasName}} alias`,
  });

  return deployment?.deploymentIdentifier;
}
