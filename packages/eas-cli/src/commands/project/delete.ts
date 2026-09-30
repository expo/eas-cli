import { getConfigFilePaths } from '@expo/config';
import { Args, Flags } from '@oclif/core';
import chalk from 'chalk';

import EasCommand from '../../commandUtils/EasCommand';
import { findProjectRootAsync } from '../../commandUtils/context/contextUtils/findProjectDirAndVerifyProjectSetupAsync';
import {
  EasNonInteractiveAndJsonFlags,
  resolveNonInteractiveAndJsonFlags,
} from '../../commandUtils/flags';
import { AppFragment } from '../../graphql/generated';
import { AppMutation } from '../../graphql/mutations/AppMutation';
import { AppQuery } from '../../graphql/queries/AppQuery';
import Log from '../../log';
import { ora } from '../../ora';
import { getPrivateExpoConfigAsync } from '../../project/expoConfig';
import { promptAsync } from '../../prompts';
import { isSudoModeRequiredError, promptForSudoModeUpgradeAsync } from '../../user/sudo';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';
import { pollForBackgroundJobReceiptAsync } from '../../utils/pollForBackgroundJobReceiptAsync';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default class ProjectDelete extends EasCommand {
  static override description = 'delete a project';

  static override args = {
    name: Args.string({
      required: false,
      description:
        'Full name (@account/slug) or ID of the project to delete. Defaults to the project in the current directory.',
    }),
  };

  static override flags = {
    'dangerously-confirm-deletion': Flags.string({
      description:
        "The project's full name (@account/slug), to confirm deletion. Required in non-interactive mode.",
    }),
    ...EasNonInteractiveAndJsonFlags,
  };

  static override contextDefinition = {
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const {
      args: { name },
      flags,
    } = await this.parse(ProjectDelete);
    const { json: jsonFlag, nonInteractive } = resolveNonInteractiveAndJsonFlags(flags);

    if (jsonFlag) {
      enableJsonOutput();
    }

    const {
      loggedIn: { graphqlClient, authenticationInfo },
    } = await this.getContextAsync(ProjectDelete, { nonInteractive });

    let app: AppFragment;
    if (name) {
      app = UUID_REGEX.test(name)
        ? await AppQuery.byIdAsync(graphqlClient, name)
        : await AppQuery.byFullNameAsync(graphqlClient, name);
    } else {
      let projectDir: string | null = null;
      try {
        projectDir = await findProjectRootAsync();
      } catch {
        // Not inside a project directory — handled by the error below.
      }

      let projectId: string | undefined;
      if (projectDir) {
        // Only read the config when one already exists: getPrivateExpoConfigAsync creates a
        // fresh app.json as a side effect when the directory has none. Config errors (broken
        // app.config.js, invalid app.json) propagate so they are not masked by the error below.
        const configPaths = getConfigFilePaths(projectDir);
        if (configPaths.staticConfigPath ?? configPaths.dynamicConfigPath) {
          const exp = await getPrivateExpoConfigAsync(projectDir);
          projectId = exp.extra?.eas?.projectId;
        }
      }
      if (!projectId) {
        throw new Error(
          "No EAS project found in the current directory. Pass the project's full name (@account/slug) or ID as an argument."
        );
      }
      app = await AppQuery.byIdAsync(graphqlClient, projectId);
    }

    const confirmedFullName = flags['dangerously-confirm-deletion'];
    if (confirmedFullName) {
      if (confirmedFullName !== app.fullName) {
        throw new Error(
          `The value of --dangerously-confirm-deletion ("${confirmedFullName}") did not match the project's full name ("${app.fullName}"). Cancelled deletion.`
        );
      }
    } else if (nonInteractive) {
      throw new Error(
        `Deleting a project in non-interactive mode requires passing --dangerously-confirm-deletion with the project's full name ("${app.fullName}").`
      );
    } else {
      Log.addNewLineIfNone();
      Log.warn(
        `You are about to permanently delete project ${chalk.bold(app.fullName)}.` +
          `\nThis will delete everything associated with it, including builds, submissions, update branches, published updates, and environment variables.` +
          `\nThis action is irreversible.`
      );
      Log.newLine();
      const { confirmedName } = await promptAsync({
        type: 'text',
        name: 'confirmedName',
        message: `Type the project's full name (${app.fullName}) to confirm deletion:`,
      });
      if (confirmedName !== app.fullName) {
        Log.error(`The input did not match the project's full name. Cancelled deletion.`);
        process.exit(1);
      }
    }

    const spinner = ora(`Deleting project ${app.fullName}`).start();
    try {
      let receipt;
      try {
        receipt = await AppMutation.scheduleAppDeletionAsync(graphqlClient, app.id);
      } catch (error) {
        if (!isSudoModeRequiredError(error)) {
          throw error;
        }
        if (nonInteractive) {
          throw new Error(
            'Deleting a project requires a session in sudo mode. Run this command interactively to confirm your password, then retry in non-interactive mode while sudo mode is active.'
          );
        }
        spinner.stop();
        await promptForSudoModeUpgradeAsync(authenticationInfo);
        spinner.start();
        receipt = await AppMutation.scheduleAppDeletionAsync(graphqlClient, app.id);
      }
      await pollForBackgroundJobReceiptAsync(graphqlClient, receipt);
      spinner.succeed(`Deleted project ${chalk.bold(app.fullName)}`);
    } catch (error) {
      spinner.fail(`Failed to delete project ${chalk.bold(app.fullName)}`);
      throw error;
    }

    if (jsonFlag) {
      printJsonOnlyOutput({ id: app.id, fullName: app.fullName });
    }
  }
}
