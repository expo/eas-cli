import { Flags } from '@oclif/core';
import * as fs from 'fs-extra';

import EasCommand from '../../commandUtils/EasCommand';
import { EASEnvironmentFlag, EASNonInteractiveFlag } from '../../commandUtils/flags';
import {
  EnvironmentVariableEnvironment,
  EnvironmentVariableFragment,
} from '../../graphql/generated';
import { EnvironmentVariablesQuery } from '../../graphql/queries/EnvironmentVariablesQuery';
import Log from '../../log';
import { confirmAsync } from '../../prompts';
import { promptVariableEnvironmentAsync } from '../../utils/prompts';

export default class EnvironmentValuePull extends EasCommand {
  static override description = 'pull env file';

  static override hidden = true;

  static override contextDefinition = {
    ...this.ContextOptions.ProjectConfig,
    ...this.ContextOptions.LoggedIn,
  };

  static override flags = {
    ...EASEnvironmentFlag,
    ...EASNonInteractiveFlag,
    path: Flags.string({
      description: 'Path to the result `.env` file',
      default: '.env.local',
    }),
  };

  async runAsync(): Promise<void> {
    let {
      flags: { environment, path: targetPath, 'non-interactive': nonInteractive },
    } = await this.parse(EnvironmentValuePull);

    if (!environment) {
      environment = await promptVariableEnvironmentAsync(nonInteractive);
    }
    const {
      privateProjectConfig: { projectId },
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(EnvironmentValuePull, {
      nonInteractive,
    });

    targetPath = targetPath ?? '.env.local';

    const environmentVariables = await EnvironmentVariablesQuery.byAppIdWithSensitiveAsync(
      graphqlClient,
      {
        appId: projectId,
        environment,
      }
    );

    if (!nonInteractive && (await fs.exists(targetPath))) {
      const result = await confirmAsync({
        message: `File ${targetPath} already exists. Do you want to overwrite it?`,
      });
      if (!result) {
        Log.log('Aborting...');
        throw new Error(`File ${targetPath} already exists.`);
      }
    }

    const filePrefix = `# Environment: ${environment}\n\n`;

    const envFileContent = environmentVariables
      .filter((variable: EnvironmentVariableFragment) => !!variable.value)
      .map((variable: EnvironmentVariableFragment) => {
        if (variable.value === null) {
          return `# ${variable.name}=***** (secret variables are not available for reading)`;
        }
        return `${variable.name}=${variable.value}`;
      })
      .join('\n');
    await fs.writeFile(targetPath, filePrefix + envFileContent);

    Log.log(`Pulled environment variables from ${environment} environment to ${targetPath}.`);
  }

  private validateFlags(flags: PullFlags): PullFlags {
    if (!flags.environment) {
      throw new Error('Please provide an environment to pull the env file from.');
    }
    return flags;
  }
}
