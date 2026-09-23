import { Flags } from '@oclif/core';
import chalk from 'chalk';

import EasCommand from '../../../commandUtils/EasCommand';
import {
  EasNonInteractiveAndJsonFlags,
  resolveNonInteractiveAndJsonFlags,
} from '../../../commandUtils/flags';
import { loadProjectScopedEnvVarsAsync } from '../../../environments/variables';
import { EnvironmentVariableMutation } from '../../../graphql/mutations/EnvironmentVariableMutation';
import {
  EAS_DETOUR_API_KEY_ENV_VAR_NAME,
  EAS_DETOUR_APP_ID_ENV_VAR_NAME,
  removeEnvLocalKeysAsync,
} from '../../../integrations/detour/env';
import { readConnection, removeFromAppConfigAsync } from '../../../integrations/detour/linking';
import Log from '../../../log';
import { confirmAsync } from '../../../prompts';
import { enableJsonOutput, printJsonOnlyOutput } from '../../../utils/json';

export default class IntegrationsDetourDisconnect extends EasCommand {
  static override description =
    'remove the Detour connection from this project: app config entries, .env.local keys, and EAS environment variables';

  static override examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --yes',
  ];

  static override contextDefinition = {
    ...this.ContextOptions.ProjectConfig,
  };

  static override flags = {
    ...EasNonInteractiveAndJsonFlags,
    yes: Flags.boolean({
      char: 'y',
      description: 'Skip confirmation prompt',
      default: false,
    }),
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(IntegrationsDetourDisconnect);
    const { yes } = flags;
    const { json: jsonFlag, nonInteractive } = resolveNonInteractiveAndJsonFlags(flags);
    if (jsonFlag) {
      enableJsonOutput();
    }

    const {
      privateProjectConfig: { projectId, projectDir, exp },
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(IntegrationsDetourDisconnect, {
      nonInteractive,
      withServerSideEnvironment: null,
    });

    const connection = readConnection(exp);
    if (!connection) {
      if (jsonFlag) {
        printJsonOnlyOutput({ appId: null });
      } else {
        Log.log(`${chalk.bold(exp.slug)} is not connected to Detour.`);
      }
      return;
    }

    // The Detour app is kept: links, analytics and credentials stay as they are.
    if (!yes && !nonInteractive) {
      Log.log('This will remove:');
      Log.log(`  ${EAS_DETOUR_APP_ID_ENV_VAR_NAME} and ${EAS_DETOUR_API_KEY_ENV_VAR_NAME}`);
      Log.log('    from .env.local and from every EAS environment that has them');
      if (connection.linkHost) {
        Log.log(`  ${connection.linkHost} from ios.associatedDomains and android.intentFilters`);
      }
      Log.log('  extra.detour from your app config');
      Log.newLine();

      const confirmed = await confirmAsync({
        message: `Disconnect ${chalk.bold(exp.slug)} from Detour app ${connection.appId}? The app and its data are kept in Detour.`,
      });
      if (!confirmed) {
        Log.log('Nothing was changed.');
        return;
      }
    }

    const manualSteps: string[] = [];
    const appConfigStep = await removeFromAppConfigAsync(projectDir, {
      linkHost: connection.linkHost,
    });
    if (appConfigStep) {
      manualSteps.push(appConfigStep);
    }
    if (!connection.linkHost) {
      manualSteps.push(
        'This connection predates link-host tracking, so the domain entries in "ios.associatedDomains" and "android.intentFilters" were left in place. Remove them by hand.'
      );
    }

    if (await removeEnvLocalKeysAsync(projectDir)) {
      Log.withTick('Removed the Detour keys from .env.local');
    }

    for (const name of [EAS_DETOUR_APP_ID_ENV_VAR_NAME, EAS_DETOUR_API_KEY_ENV_VAR_NAME]) {
      const variables = await loadProjectScopedEnvVarsAsync(graphqlClient, projectId, name);
      for (const variable of variables) {
        await EnvironmentVariableMutation.deleteAsync(graphqlClient, variable.id);
      }
    }
    Log.withTick('Removed the Detour environment variables from EAS');

    if (jsonFlag) {
      printJsonOnlyOutput({ appId: connection.appId, manualSteps });
      return;
    }
    for (const step of manualSteps) {
      Log.warn(step);
    }
    Log.log(`Disconnected from Detour app ${chalk.bold(connection.appId)}.`);
    // Uninstalling packages the project may still import is not our call.
    Log.log(
      'The Detour SDK packages are still installed. Remove them yourself if you no longer need them.'
    );
  }
}
