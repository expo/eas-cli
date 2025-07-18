import chalk from 'chalk';

import EasCommand from '../../../commandUtils/EasCommand';
import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { EasNonInteractiveAndJsonFlags } from '../../../commandUtils/flags';
import Log from '../../../log';
import { Ora, ora } from '../../../ora';
import { toggleConfirmAsync } from '../../../prompts';
import { enableJsonOutput, printJsonOnlyOutput } from '../../../utils/json';
import {
  deleteWorkerDeploymentAliasAsync,
  selectWorkerDeploymentAliasOnAppAsync,
} from '../../../worker/deployment';

interface DeployAliasDeleteFlags {
  nonInteractive: boolean;
  json: boolean;
}

export default class WorkerAliasDelete extends EasCommand {
  static override description = 'Delete deployment aliases.';
  static override aliases = ['worker:alias:delete'];
  static override state = 'preview';

  static override args = [{ name: 'ALIAS_NAME' }];
  static override flags = {
    ...EasNonInteractiveAndJsonFlags,
  };

  static override contextDefinition = {
    ...this.ContextOptions.DynamicProjectConfig,
    ...this.ContextOptions.ProjectDir,
    ...this.ContextOptions.LoggedIn,
  };

  override async runAsync(): Promise<void> {
    const {
      args: { ALIAS_NAME: aliasNameFromArg },
      flags: rawFlags,
    } = await this.parse(WorkerAliasDelete);
    const flags = this.sanitizeFlags(rawFlags);

    if (flags.json) {
      enableJsonOutput();
    }

    Log.warn('EAS Hosting is still in preview and subject to changes.');

    const {
      getDynamicPrivateProjectConfigAsync,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(WorkerAliasDelete, {
      nonInteractive: true,
      withServerSideEnvironment: null,
    });

    const { projectId } = await getDynamicPrivateProjectConfigAsync();
    const aliasName = await resolveDeploymentAliasAsync(
      flags,
      graphqlClient,
      projectId,
      aliasNameFromArg
    );

    const isProduction = !aliasName;

    if (!flags.nonInteractive) {
      Log.addNewLineIfNone();
      Log.warn(
        isProduction
          ? `You are about to delete your production alias`
          : `You are about to delete alias: "${aliasName}"`
      );
      Log.newLine();
      const confirmed = await toggleConfirmAsync({ message: 'Are you sure you wish to proceed?' });

      if (!confirmed) {
        Log.log('Aborted.');
        return;
      }
    }

    let progress: null | Ora = null;
    let deleteResult: null | Awaited<ReturnType<typeof deleteWorkerDeploymentAliasAsync>> = null;

    try {
      progress = ora(chalk`Deleting alias {bold ${aliasName ?? 'production'}}`).start();
      deleteResult = await deleteWorkerDeploymentAliasAsync({
        graphqlClient,
        appId: projectId,
        aliasName,
      });
      progress.text = chalk`Deleted alias {bold ${aliasName ?? 'production'}}`;
    } catch (error: any) {
      progress?.fail(chalk`Failed to delete alias {bold ${aliasName ?? 'production'}}`);
      throw error;
    }

    progress?.succeed(chalk`Deleted alias {bold ${aliasName ?? 'production'}}`);

    if (flags.json) {
      printJsonOnlyOutput({
        aliasName: deleteResult.aliasName,
        id: deleteResult.id,
      });
    }
  }

  private sanitizeFlags(flags: any): DeployAliasDeleteFlags {
    return {
      nonInteractive: flags['non-interactive'],
      json: flags['json'],
    };
  }
}

async function resolveDeploymentAliasAsync(
  flags: DeployAliasDeleteFlags,
  graphqlClient: ExpoGraphqlClient,
  projectId: string,
  aliasNameFromArg?: string
): Promise<string> {
  if (aliasNameFromArg?.trim()) {
    return aliasNameFromArg.trim().toLowerCase();
  }

  if (flags.nonInteractive) {
    throw new Error('Alias name must be provided in non-interactive mode');
  }

  const alias = await selectWorkerDeploymentAliasOnAppAsync({
    graphqlClient,
    appId: projectId,
    selectTitle: 'alias to delete',
  });

  if (!alias) {
    throw new Error('No aliases found for this project, create aliases with "eas deploy:alias"');
  }

  return alias.aliasName;
}
