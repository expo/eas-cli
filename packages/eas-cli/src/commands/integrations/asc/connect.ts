import { Flags } from '@oclif/core';
import chalk from 'chalk';

import EasCommand from '../../../commandUtils/EasCommand';
import { EasCommandError } from '../../../commandUtils/errors';
import {
  EasNonInteractiveAndJsonFlags,
  resolveNonInteractiveAndJsonFlags,
} from '../../../commandUtils/flags';
import { CredentialsContext } from '../../../credentials/context';
import { buildJsonOutput, formatAscAppLinkStatus } from '../../../integrations/asc/utils';
import { selectOrCreateAscApiKeyIdAsync } from '../../../integrations/asc/ascApiKey';
import { AppStoreConnectApiKeyQuery } from '../../../credentials/ios/api/graphql/queries/AppStoreConnectApiKeyQuery';
import { AscAppLinkMutation } from '../../../graphql/mutations/AscAppLinkMutation';
import { AscAppLinkQuery } from '../../../graphql/queries/AscAppLinkQuery';
import Log from '../../../log';
import { ora } from '../../../ora';
import { selectAsync } from '../../../prompts';
import { enableJsonOutput, printJsonOnlyOutput } from '../../../utils/json';

type DiscoveredAscApps = Awaited<ReturnType<typeof AscAppLinkQuery.discoverAccessibleAppsAsync>>;

export default class IntegrationsAscConnect extends EasCommand {
  static override description = 'connect a project to an App Store Connect app';

  static override flags = {
    'api-key-id': Flags.string({
      description: 'Apple App Store Connect API Key ID',
    }),
    'asc-app-id': Flags.string({
      description: 'App Store Connect app identifier',
    }),
    'bundle-id': Flags.string({
      description: 'Filter discovered apps by bundle identifier',
    }),
    ...EasNonInteractiveAndJsonFlags,
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectId,
    ...this.ContextOptions.ProjectDir,
    ...this.ContextOptions.LoggedIn,
    ...this.ContextOptions.Analytics,
    ...this.ContextOptions.Vcs,
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(IntegrationsAscConnect);
    const { json, nonInteractive } = resolveNonInteractiveAndJsonFlags(flags);
    if (json) {
      enableJsonOutput();
    }

    if (nonInteractive) {
      if (!flags['api-key-id']) {
        throw new EasCommandError('--api-key-id is required in non-interactive mode.');
      }
      if (!flags['asc-app-id']) {
        throw new EasCommandError('--asc-app-id is required in non-interactive mode.');
      }
    }

    const {
      projectId,
      projectDir,
      loggedIn: { actor, graphqlClient },
      analytics,
      vcsClient,
    } = await this.getContextAsync(IntegrationsAscConnect, {
      nonInteractive,
    });

    // Step 1: Check current status
    const statusSpinner = ora('Checking current App Store Connect app link status').start();
    const metadata = await AscAppLinkQuery.getAppMetadataAsync(graphqlClient, projectId);
    statusSpinner.succeed('Checked current status');

    if (metadata.appStoreConnectApp) {
      throw new EasCommandError(
        `Project ${chalk.bold(metadata.fullName)} is already connected to App Store Connect app ${chalk.bold(metadata.appStoreConnectApp.ascAppIdentifier)}. Disconnect first with ${chalk.bold('eas integrations:asc:disconnect')}.`
      );
    }

    // Step 2: Get ASC API key
    const keysSpinner = ora('Fetching App Store Connect API keys').start();
    const keys = await AppStoreConnectApiKeyQuery.getAllForAccountAsync(
      graphqlClient,
      metadata.ownerAccount.name
    );
    keysSpinner.succeed(`Found ${keys.length} API key(s)`);

    let apiKeyId = flags['api-key-id'];
    if (!apiKeyId) {
      const credentialsContext = new CredentialsContext({
        projectInfo: null,
        nonInteractive,
        projectDir,
        user: actor,
        graphqlClient,
        analytics,
        vcsClient,
      });

      apiKeyId = await selectOrCreateAscApiKeyIdAsync({
        credentialsContext,
        existingKeys: keys,
        ownerAccount: metadata.ownerAccount,
      });
    } else {
      const keysByAppleId = keys.filter(key => key.keyIdentifier === apiKeyId);
      if (keysByAppleId.length > 1) {
        throw new EasCommandError(
          `Multiple App Store Connect API keys match Apple key identifier "${apiKeyId}".`
        );
      } else if (keysByAppleId.length === 1) {
        apiKeyId = keysByAppleId[0].id;
      } else {
        throw new EasCommandError(
          `No App Store Connect API key found with Apple key identifier "${apiKeyId}".`
        );
      }
    }
    if (!apiKeyId) {
      throw new EasCommandError('No App Store Connect API key selected.');
    }

    // Step 3: Discover remote apps
    const discoverSpinner = ora('Discovering App Store Connect apps').start();
    let remoteApps: DiscoveredAscApps;
    try {
      remoteApps = await AscAppLinkQuery.discoverAccessibleAppsAsync(
        graphqlClient,
        apiKeyId,
        flags['bundle-id']
      );
      discoverSpinner.succeed(`Found ${remoteApps.length} app(s) on App Store Connect`);
    } catch (err) {
      discoverSpinner.fail('Failed to discover apps');
      throw err;
    }

    if (remoteApps.length === 0) {
      throw new EasCommandError(
        'No accessible apps found on App Store Connect for the selected API key.' +
          (flags['bundle-id']
            ? ` Try removing the --bundle-id filter or verify the bundle ID "${flags['bundle-id']}".`
            : '')
      );
    }

    // Step 4: Select remote app
    let selectedApp: DiscoveredAscApps[number];
    if (flags['asc-app-id']) {
      const match = remoteApps.find(app => app.ascAppIdentifier === flags['asc-app-id']);
      if (!match) {
        throw new EasCommandError(
          `App with identifier "${flags['asc-app-id']}" was not found among accessible apps. Run ${chalk.bold('eas integrations:asc:connect')} interactively to discover available apps.`
        );
      }
      selectedApp = match;
    } else {
      selectedApp = await selectAsync<DiscoveredAscApps[number]>(
        'Select an App Store Connect app:',
        remoteApps.map(app => ({
          title: `${app.name} (${app.bundleIdentifier}) [${app.ascAppIdentifier}]`,
          value: app,
        }))
      );
    }

    // Step 5: Create link
    const createSpinner = ora('Connecting project to App Store Connect app').start();
    try {
      await AscAppLinkMutation.createAppStoreConnectAppAsync(graphqlClient, {
        appId: metadata.id,
        ascAppIdentifier: selectedApp.ascAppIdentifier,
        appStoreConnectApiKeyId: apiKeyId,
      });
      createSpinner.succeed('Connected project to App Store Connect app');
    } catch (err) {
      createSpinner.fail('Failed to connect project');
      throw err;
    }

    // Step 6: Refetch and display
    const refetchSpinner = ora('Verifying connection').start();
    const updatedMetadata = await AscAppLinkQuery.getAppMetadataAsync(graphqlClient, projectId);
    refetchSpinner.succeed('Verified connection');

    if (json) {
      printJsonOnlyOutput(buildJsonOutput('connect', updatedMetadata));
    } else {
      Log.addNewLineIfNone();
      Log.log(formatAscAppLinkStatus(updatedMetadata));
    }
  }
}
