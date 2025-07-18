import chalk from 'chalk';

import EasCommand from '../../commandUtils/EasCommand';
import { EasNonInteractiveAndJsonFlags } from '../../commandUtils/flags';
import Log from '../../log';
import { Ora, ora } from '../../ora';
import { toggleConfirmAsync } from '../../prompts';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';
import { deleteWorkerDeploymentAsync } from '../../worker/deployment';

interface DeployDeleteFlags {
  nonInteractive: boolean;
  json: boolean;
}

interface RawDeployDeleteFlags {
  'non-interactive': boolean;
  json: boolean;
}

export default class WorkerDelete extends EasCommand {
  static override description = 'Delete a deployment.';
  static override aliases = ['worker:delete'];
  static override state = 'preview';

  static override args = [{ name: 'DEPLOYMENT_ID' }];
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
      args: { DEPLOYMENT_ID: deploymentIdFromArg },
      flags: rawFlags,
    } = await this.parse(WorkerDelete);
    const flags = this.sanitizeFlags(rawFlags);

    if (flags.json) {
      enableJsonOutput();
    }

    Log.warn('EAS Hosting is still in preview and subject to changes.');

    const {
      getDynamicPrivateProjectConfigAsync,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(WorkerDelete, {
      nonInteractive: true,
      withServerSideEnvironment: null,
    });

    const { projectId } = await getDynamicPrivateProjectConfigAsync();

    if (!deploymentIdFromArg) {
      if (flags.nonInteractive) {
        throw new Error('Deployment ID must be provided in non-interactive mode');
      }
      throw new Error('Deployment ID is required');
    }

    if (!flags.nonInteractive) {
      Log.addNewLineIfNone();
      Log.warn(
        `You are about to permanently delete deployment with ID: "${deploymentIdFromArg}"` +
          `\nThis action is irreversible.`
      );
      Log.newLine();
      const confirmed = await toggleConfirmAsync({ message: 'Are you sure you wish to proceed?' });

      if (!confirmed) {
        Log.log('Aborted.');
        return;
      }
    }

    let progress: Ora | null = null;
    let deleteResult: null | Awaited<ReturnType<typeof deleteWorkerDeploymentAsync>> = null;

    try {
      progress = ora(chalk`Deleting deployment {bold ${deploymentIdFromArg}}`).start();
      deleteResult = await deleteWorkerDeploymentAsync({
        graphqlClient,
        appId: projectId,
        deploymentIdentifier: deploymentIdFromArg,
      });
      progress.text = chalk`Deleted deployment {bold ${deploymentIdFromArg}}`;
    } catch (error: any) {
      progress?.fail(chalk`Failed to delete deployment {bold ${deploymentIdFromArg}}`);
      throw error;
    }

    progress?.succeed(chalk`Deleted deployment {bold ${deploymentIdFromArg}}`);

    if (flags.json) {
      printJsonOnlyOutput({
        deploymentId: deleteResult.deploymentIdentifier,
        id: deleteResult.id,
      });
    }
  }

  private sanitizeFlags(flags: RawDeployDeleteFlags): DeployDeleteFlags {
    return {
      nonInteractive: flags['non-interactive'],
      json: flags['json'],
    };
  }
}
