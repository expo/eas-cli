import { Flags } from '@oclif/core';
import chalk from 'chalk';

import EasCommand from '../../../commandUtils/EasCommand';
import {
  EasNonInteractiveAndJsonFlags,
  resolveNonInteractiveAndJsonFlags,
} from '../../../commandUtils/flags';
import { buildJsonOutput, formatAscAppLinkStatus } from '../../../connections/asc/utils';
import { AscAppLinkMutation } from '../../../graphql/mutations/AscAppLinkMutation';
import { AscAppLinkQuery } from '../../../graphql/queries/AscAppLinkQuery';
import Log from '../../../log';
import { ora } from '../../../ora';
import { toggleConfirmAsync } from '../../../prompts';
import { enableJsonOutput, printJsonOnlyOutput } from '../../../utils/json';

export default class ConnectionsAscDisconnect extends EasCommand {
  static override description = 'disconnect the current project from its App Store Connect app';

  static override flags = {
    yes: Flags.boolean({
      description: 'Skip confirmation prompt',
      default: false,
    }),
    ...EasNonInteractiveAndJsonFlags,
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectId,
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(ConnectionsAscDisconnect);
    const { json, nonInteractive } = resolveNonInteractiveAndJsonFlags(flags);
    if (json) {
      enableJsonOutput();
    }

    const {
      projectId,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(ConnectionsAscDisconnect, {
      nonInteractive: nonInteractive || flags.yes,
    });

    // Step 1: Check current status
    const statusSpinner = ora('Checking current App Store Connect app link status').start();
    const metadata = await AscAppLinkQuery.getAppMetadataAsync(graphqlClient, projectId);
    statusSpinner.succeed('Checked current status');

    if (!metadata.appStoreConnectApp) {
      if (json) {
        printJsonOnlyOutput(buildJsonOutput('disconnect', metadata));
      } else {
        Log.addNewLineIfNone();
        Log.log(
          `Project ${chalk.bold(metadata.fullName)} is not connected to any App Store Connect app.`
        );
      }
      return;
    }

    // Step 2: Confirm
    if (!flags.yes && !nonInteractive) {
      Log.addNewLineIfNone();
      Log.log(formatAscAppLinkStatus(metadata));
      Log.newLine();
      Log.warn(
        'You are about to disconnect this project from its App Store Connect app.\nThis action is reversible by reconnecting.'
      );
      Log.newLine();
      const confirmed = await toggleConfirmAsync({
        message: 'Are you sure you wish to proceed?',
      });
      if (!confirmed) {
        Log.error('Canceled disconnection');
        process.exit(1);
      }
    }

    // Step 3: Delete
    const deleteSpinner = ora('Disconnecting App Store Connect app').start();
    try {
      await AscAppLinkMutation.deleteAppStoreConnectAppAsync(
        graphqlClient,
        metadata.appStoreConnectApp.id
      );
      deleteSpinner.succeed('Disconnected App Store Connect app');
    } catch (err) {
      deleteSpinner.fail('Failed to disconnect App Store Connect app');
      throw err;
    }

    // Step 4: Refetch and display
    const refetchSpinner = ora('Verifying disconnection').start();
    const updatedMetadata = await AscAppLinkQuery.getAppMetadataAsync(graphqlClient, projectId, {
      useCache: false,
    });
    refetchSpinner.succeed('Verified disconnection');

    if (json) {
      printJsonOnlyOutput(buildJsonOutput('disconnect', updatedMetadata));
    } else {
      Log.addNewLineIfNone();
      Log.log(formatAscAppLinkStatus(updatedMetadata));
    }
  }
}
