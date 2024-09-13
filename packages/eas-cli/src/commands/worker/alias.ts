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
import { EasNonInteractiveAndJsonFlags } from '../../commandUtils/flags';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

interface DeployAliasFlags {
  nonInteractive: boolean;
  json: boolean;
  aliasName?: string;
  deploymentIdentifier?: string;
}

interface RawDeployAliasFlags {
  'non-interactive': boolean;
  json: boolean;
  alias?: string;
  id?: string;
}

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
    ...EasNonInteractiveAndJsonFlags,
  };

  static override contextDefinition = {
    ...this.ContextOptions.DynamicProjectConfig,
    ...this.ContextOptions.ProjectDir,
    ...this.ContextOptions.LoggedIn,
  };

  override async runAsync(): Promise<void> {
    // NOTE(cedric): `Log.warn` uses `console.log`, which is incorrect when running with `--json`
    // eslint-disable-next-line no-console
    console.warn(
      chalk.yellow('EAS Worker Deployments are in beta and subject to breaking changes.')
    );

    const { flags: rawFlags } = await this.parse(WorkerAlias);
    const flags = this.sanitizeFlags(rawFlags);

    if (flags.json) {
      enableJsonOutput();
    }

    const {
      getDynamicPrivateProjectConfigAsync,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(WorkerAlias, {
      nonInteractive: true,
    });

    const { projectId } = await getDynamicPrivateProjectConfigAsync();
    const aliasName = await resolveDeploymentAliasAsync(flags);
    const deploymentId = await resolveDeploymentIdAsync({
      ...flags,
      graphqlClient,
      projectId,
      aliasName,
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

    if (flags.json) {
      return printJsonOnlyOutput({
        dashboardUrl: expoDashboardUrl,
        deployment: {
          id: deploymentId,
          aliases: [{
            id: workerAlias.id,
            name: workerAlias.aliasName,
            url: workerAlias.url,
          }]
        },
      });
    }

    Log.addNewLineIfNone();
    Log.log(
      formatFields([
        { label: 'Dashboard', value: expoDashboardUrl },
        { label: 'Alias URL', value: chalk.cyan(workerAlias.url) },
      ])
    );
  }

  private sanitizeFlags(flags: RawDeployAliasFlags): DeployAliasFlags {
    return {
      nonInteractive: flags['non-interactive'],
      json: flags['json'],
      aliasName: flags.alias?.trim().toLowerCase(),
      deploymentIdentifier: flags.id?.trim().toLowerCase(),
    };
  }
}

async function resolveDeploymentAliasAsync(flags: DeployAliasFlags): Promise<string> {
  if (flags.aliasName?.trim()) {
    return flags.aliasName.trim().toLowerCase();
  }

  if (flags.nonInteractive) {
    throw new Error(
      'The `--alias` flag must be set when running in `--non-interactive` mode.'
    );
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
  deploymentIdentifier,
  aliasName,
  projectId,
  nonInteractive,
}: DeployAliasFlags & {
  graphqlClient: ExpoGraphqlClient;
  projectId: string;
}): Promise<string> {
  if (deploymentIdentifier) {
    return deploymentIdentifier;
  }

  if (nonInteractive) {
    throw new Error(
      'The `--id` flag must be set when running in `--non-interactive` mode.'
    );
  }

  const deployment = await selectWorkerDeploymentOnAppAsync({
    graphqlClient,
    appId: projectId,
    selectTitle: chalk`deployment to assign the {underline ${aliasName}} alias`,
  });

  return deployment?.deploymentIdentifier;
}
