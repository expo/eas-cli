import { Flags } from '@oclif/core';
import chalk from 'chalk';

import EasCommand from '../../../commandUtils/EasCommand';
import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import {
  EasNonInteractiveAndJsonFlags,
  resolveNonInteractiveAndJsonFlags,
} from '../../../commandUtils/flags';
import {
  buildInvalidJsonOutput,
  buildJsonOutput,
  formatAscAppLinkStatus,
  isAscAuthenticationError,
} from '../../../integrations/asc/utils';
import { AscAppLinkMutation } from '../../../graphql/mutations/AscAppLinkMutation';
import { AscAppLinkQuery } from '../../../graphql/queries/AscAppLinkQuery';
import Log from '../../../log';
import { ora } from '../../../ora';
import { toggleConfirmAsync } from '../../../prompts';
import { enableJsonOutput, printJsonOnlyOutput } from '../../../utils/json';

export default class IntegrationsAscDisconnect extends EasCommand {
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
    const { flags } = await this.parse(IntegrationsAscDisconnect);
    const { json, nonInteractive } = resolveNonInteractiveAndJsonFlags(flags);
    if (json) {
      enableJsonOutput();
    }

    const {
      projectId,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(IntegrationsAscDisconnect, {
      nonInteractive: nonInteractive || flags.yes,
    });

    // Step 1: Check current status
    const metadata = await this.fetchCurrentStatusAsync(graphqlClient, projectId);
    if (!metadata) {
      if (json) {
        printJsonOnlyOutput(buildInvalidJsonOutput('disconnect', projectId));
      } else {
        Log.addNewLineIfNone();
        Log.warn(
          'The App Store Connect API key linked to this project has been revoked or is no longer valid.\nThe connection cannot be resolved from the CLI. Please update the API key on the Expo dashboard.'
        );
      }
      return;
    }

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

  private async fetchCurrentStatusAsync(
    graphqlClient: ExpoGraphqlClient,
    projectId: string
  ): Promise<Awaited<ReturnType<typeof AscAppLinkQuery.getAppMetadataAsync>> | null> {
    const spinner = ora('Checking current App Store Connect app link status').start();
    try {
      const metadata = await AscAppLinkQuery.getAppMetadataAsync(graphqlClient, projectId);
      spinner.succeed('Checked current status');
      return metadata;
    } catch (err) {
      if (isAscAuthenticationError(err)) {
        spinner.fail('App Store Connect connection is invalid');
        return null;
      }
      spinner.fail('Failed to check current status');
      throw err;
    }
  }
}
