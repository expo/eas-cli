import { Flags } from '@oclif/core';
import chalk from 'chalk';

import EasCommand from '../../commandUtils/EasCommand';
import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { EasNonInteractiveAndJsonFlags } from '../../commandUtils/flags';
import { WorkerDeploymentAliasFragment } from '../../graphql/generated';
import Log from '../../log';
import { Ora, ora } from '../../ora';
import { promptAsync } from '../../prompts';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';
import {
  assignWorkerDeploymentAliasAsync,
  assignWorkerDeploymentProductionAsync,
  selectWorkerDeploymentOnAppAsync,
} from '../../worker/deployment';
import { formatWorkerDeploymentJson, formatWorkerDeploymentTable } from '../../worker/utils/logs';

interface DeployAliasFlags {
  nonInteractive: boolean;
  json: boolean;
  aliasName?: string | null;
  deploymentIdentifier?: string | null;
  isProduction: boolean;
}

interface RawDeployAliasFlags {
  'non-interactive': boolean;
  json: boolean;
  alias?: string;
  id?: string;
  prod: boolean;
}

export default class WorkerAlias extends EasCommand {
  static override description = 'Assign deployment aliases.';
  static override aliases = ['worker:alias', 'deploy:promote'];
  static override state = 'preview';

  static override flags = {
    prod: Flags.boolean({
      aliases: ['production'],
      description: 'Promote an existing deployment to production.',
      default: false,
    }),
    alias: Flags.string({
      description: 'Custom alias to assign to the existing deployment.',
      helpValue: 'name',
      required: false,
    }),
    id: Flags.string({
      description: 'Unique identifier of an existing deployment.',
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
    const { flags: rawFlags } = await this.parse(WorkerAlias);
    const flags = this.sanitizeFlags(rawFlags);

    if (flags.json) {
      enableJsonOutput();
    }

    Log.warn('EAS Hosting is still in preview and subject to changes.');

    const {
      getDynamicPrivateProjectConfigAsync,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(WorkerAlias, {
      nonInteractive: true,
      withServerSideEnvironment: null,
    });

    const { projectId } = await getDynamicPrivateProjectConfigAsync();
    const aliasName = await resolveDeploymentAliasAsync(flags);
    const deploymentId = await resolveDeploymentIdAsync({
      ...flags,
      graphqlClient,
      projectId,
      aliasName,
    });

    let progress: null | Ora = null;
    let deploymentAlias: null | Awaited<ReturnType<typeof assignWorkerDeploymentAliasAsync>> = null;

    if (aliasName) {
      try {
        progress = ora(chalk`Assigning alias {bold ${aliasName}} to deployment`).start();
        deploymentAlias = await assignWorkerDeploymentAliasAsync({
          graphqlClient,
          appId: projectId,
          deploymentId,
          aliasName,
        });
        progress.text = chalk`Assigned alias {bold ${aliasName}} to deployment`;
      } catch (error: any) {
        progress?.fail(chalk`Failed to assign {bold ${aliasName}} alias to deployment`);
        throw error;
      }
    }

    let deploymentProdAlias: null | Awaited<
      ReturnType<typeof assignWorkerDeploymentProductionAsync>
    > = null;

    if (flags.isProduction) {
      try {
        progress = (progress ?? ora()).start(chalk`Promoting deployment to {bold production}`);
        deploymentProdAlias = await assignWorkerDeploymentProductionAsync({
          graphqlClient,
          appId: projectId,
          deploymentId,
        });
        progress.text = chalk`Promoted deployment to {bold production}`;
      } catch (error: any) {
        progress?.fail(chalk`Failed to promote deployment to {bold production}`);
        throw error;
      }
    }

    progress?.succeed(
      !deploymentAlias
        ? chalk`Promoted deployment to {bold production}`
        : chalk`Promoted deployment to {bold production} with alias {bold ${deploymentAlias.aliasName}}`
    );

    // Either use the alias, or production deployment information
    const deployment = deploymentAlias?.workerDeployment ?? deploymentProdAlias?.workerDeployment;

    if (flags.json) {
      printJsonOnlyOutput(
        formatWorkerDeploymentJson({
          projectId,
          deployment: deployment!,
          aliases: [deploymentAlias].filter(Boolean) as WorkerDeploymentAliasFragment[],
          production: deploymentProdAlias,
        })
      );
      return;
    }

    Log.addNewLineIfNone();
    Log.log(`🎉 Your deployment is modified`);
    Log.addNewLineIfNone();
    Log.log(
      formatWorkerDeploymentTable({
        projectId,
        deployment: deployment!,
        aliases: [deploymentAlias].filter(Boolean) as WorkerDeploymentAliasFragment[],
        production: deploymentProdAlias,
      })
    );
  }

  private sanitizeFlags(flags: RawDeployAliasFlags): DeployAliasFlags {
    return {
      nonInteractive: flags['non-interactive'],
      json: flags['json'],
      aliasName: flags.alias?.trim().toLowerCase(),
      deploymentIdentifier: flags.id?.trim().toLowerCase(),
      isProduction: flags.prod,
    };
  }
}

async function resolveDeploymentAliasAsync(flags: DeployAliasFlags): Promise<string | null> {
  if (flags.aliasName?.trim()) {
    return flags.aliasName.trim().toLowerCase();
  }

  // Skip alias prompt when promoting deployments to prod
  if (flags.isProduction) {
    return null;
  }

  if (flags.nonInteractive) {
    throw new Error('The `--alias` flag must be set when running in `--non-interactive` mode.');
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
    throw new Error('The `--id` flag must be set when running in `--non-interactive` mode.');
  }

  const deployment = await selectWorkerDeploymentOnAppAsync({
    graphqlClient,
    appId: projectId,
    selectTitle: chalk`deployment to assign the {underline ${aliasName}} alias`,
  });

  if (!deployment) {
    throw new Error(
      'No deployments found for this project, create a new deployment with "eas deploy"'
    );
  }

  return deployment.deploymentIdentifier;
}
