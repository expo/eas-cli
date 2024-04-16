import { Flags } from '@oclif/core';
import fs from 'fs-extra';

import { handleSudoCallAsync } from '../../authUtils';
import EasCommand from '../../commandUtils/EasCommand';
import { EASEnvironmentFlag } from '../../commandUtils/flags';
import { EnvironmentVariableFragment } from '../../graphql/generated';
import { EnvironmentVariablesQuery } from '../../graphql/queries/EnvironmentVariablesQuery';
import Log from '../../log';
import { confirmAsync } from '../../prompts';

export default class EnvironmentValuePull extends EasCommand {
  static override description = 'pull env file';

  static override contextDefinition = {
    ...this.ContextOptions.ProjectConfig,
    ...this.ContextOptions.LoggedIn,
    ...this.ContextOptions.SessionManagment,
  };

  static override flags = {
    ...EASEnvironmentFlag,
    path: Flags.string({
      description: 'Path to save the env file',
      default: '.env.local',
    }),
  };

  async runAsync(): Promise<void> {
    const {
      flags: { environment, path: targetPath },
    } = await this.parse(EnvironmentValuePull);
    const {
      privateProjectConfig: { projectId },
      loggedIn: { graphqlClient },
      sessionManager,
    } = await this.getContextAsync(EnvironmentValuePull, {
      nonInteractive: true,
    });

    if (!environment) {
      throw new Error('Please provide an environment to pull the env file from.');
    }

    const { appVariables: environmentVariables } = await handleSudoCallAsync(sessionManager, () =>
      EnvironmentVariablesQuery.byAppIdWithSensitiveAsync(graphqlClient, {
        appId: projectId,
        environment,
      })
    );

    if (await fs.exists(targetPath)) {
      const result = await confirmAsync({
        message: `File ${targetPath} already exists. Do you want to overwrite it?`,
      });
      if (!result) {
        Log.log('Aborting...');
        return;
      }
    }

    const filePrefix = `# Environment: ${environment}\n\n`;

    const envFileContent = environmentVariables
      .map((variable: EnvironmentVariableFragment) => {
        return `${variable.name}=${variable.value}`;
      })
      .join('\n');

    await fs.writeFile(targetPath, filePrefix + envFileContent);

    Log.log(`Pull env file from ${environment} environment to ${targetPath}.`);
  }
}
