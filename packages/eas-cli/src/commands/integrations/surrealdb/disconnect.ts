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
  SURREAL_ENV_VAR_NAMES,
  hasEnvLocalKeysAsync,
  removeEnvLocalKeysAsync,
} from '../../../integrations/surrealdb/env';
import Log from '../../../log';
import { confirmAsync } from '../../../prompts';
import { enableJsonOutput, printJsonOnlyOutput } from '../../../utils/json';

export default class IntegrationsSurrealdbDisconnect extends EasCommand {
  static override description =
    'remove EXPO_PUBLIC_SURREAL_* from .env.local and from every EAS environment (keeps the SurrealDB instance and its data)';

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
    const { flags } = await this.parse(IntegrationsSurrealdbDisconnect);
    const { yes } = flags;
    const { json: jsonFlag, nonInteractive } = resolveNonInteractiveAndJsonFlags(flags);
    if (jsonFlag) {
      enableJsonOutput();
    }

    const {
      privateProjectConfig: { projectId, projectDir, exp },
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(IntegrationsSurrealdbDisconnect, {
      nonInteractive,
      withServerSideEnvironment: null,
    });

    const variables = [];
    for (const name of SURREAL_ENV_VAR_NAMES) {
      variables.push(...(await loadProjectScopedEnvVarsAsync(graphqlClient, projectId, name)));
    }

    if (variables.length === 0 && !(await hasEnvLocalKeysAsync(projectDir))) {
      if (jsonFlag) {
        printJsonOnlyOutput({ envLocalRemoved: false, deletedEnvironmentVariables: [] });
      } else {
        Log.log(`${chalk.bold(exp.slug)} is not connected to SurrealDB.`);
      }
      return;
    }

    if (!yes && !nonInteractive) {
      Log.log('This will remove:');
      Log.log(`  ${SURREAL_ENV_VAR_NAMES.join(', ')}`);
      Log.log('    from .env.local and from every EAS environment that has them');
      Log.newLine();
      const confirmed = await confirmAsync({
        message: `Disconnect ${chalk.bold(exp.slug)} from SurrealDB? The instance and its data are kept.`,
      });
      if (!confirmed) {
        Log.log('Nothing was changed.');
        return;
      }
    }

    const envLocalRemoved = await removeEnvLocalKeysAsync(projectDir);
    if (envLocalRemoved) {
      Log.withTick('Removed the SurrealDB keys from .env.local');
    }

    for (const variable of variables) {
      await EnvironmentVariableMutation.deleteAsync(graphqlClient, variable.id);
    }
    if (variables.length > 0) {
      Log.withTick('Removed the SurrealDB environment variables from EAS');
    }

    if (jsonFlag) {
      printJsonOnlyOutput({
        envLocalRemoved,
        deletedEnvironmentVariables: variables.map(variable => ({
          id: variable.id,
          name: variable.name,
          environments: variable.environments ?? [],
        })),
      });
      return;
    }

    Log.log(`Disconnected ${chalk.bold(exp.slug)} from SurrealDB.`);
    // Uninstalling packages the project may still import is not our call.
    Log.log(
      'The surrealdb and expo-secure-store packages are still installed. Remove them yourself if you no longer need them.'
    );
  }
}
