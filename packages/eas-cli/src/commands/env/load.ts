import assert from 'assert';
import * as fs from 'fs-extra';
import { exists } from 'fs-extra';
import path from 'path';

import EasCommand from '../../commandUtils/EasCommand';
import { EASEnvironmentFlag, EASNonInteractiveFlag } from '../../commandUtils/flags';
import { EnvironmentVariableFragment } from '../../graphql/generated';
import { EnvironmentVariablesQuery } from '../../graphql/queries/EnvironmentVariablesQuery';
import Log from '../../log';

const EnvLocalFile = '.env.local';
const EnvOriginalLocalFile = `${EnvLocalFile}.original`;

export default class EnvironmentVariableLoad extends EasCommand {
  static override description = 'change environment variables';

  static override hidden = true;

  static override flags = {
    ...EASEnvironmentFlag,
    ...EASNonInteractiveFlag,
  };
  static override contextDefinition = {
    ...this.ContextOptions.ProjectConfig,
    ...this.ContextOptions.LoggedIn,
    ...this.ContextOptions.ProjectDir,
  };

  async runAsync(): Promise<void> {
    const {
      flags: { environment, 'non-interactive': nonInteractive },
    } = await this.parse(EnvironmentVariableLoad);

    const {
      privateProjectConfig: { projectId },
      projectDir,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(EnvironmentVariableLoad, {
      nonInteractive,
    });

    assert(environment, 'Environment is required');

    const envLocalFile = path.resolve(projectDir, EnvLocalFile);
    const envOriginalLocalFile = path.resolve(projectDir, EnvOriginalLocalFile);

    if ((await exists(envLocalFile)) && !(await exists(envOriginalLocalFile))) {
      await fs.rename(envLocalFile, envOriginalLocalFile);
    }
    Log.log('Pulling environment variables...');

    const environmentVariables = await EnvironmentVariablesQuery.byAppIdWithSensitiveAsync(
      graphqlClient,
      {
        appId: projectId,
        environment,
      }
    );

    const secretVariables = environmentVariables
      .filter(({ value }) => value === null)
      .map(({ name }) => name);

    const envFileContent = environmentVariables
      .filter((variable: EnvironmentVariableFragment) => variable.value !== null)
      .map((variable: EnvironmentVariableFragment) => {
        return `${variable.name}=${variable.value}`;
      })
      .join('\n');

    if (envFileContent.length === 0) {
      Log.warn(`No environment variables found for ${environment}.`);
      throw new Error(`Ignoring the environment.`);
    }

    await fs.writeFile(envLocalFile, envFileContent);
    await fs.appendFile(envLocalFile, `\nEAS_CURRENT_ENVIRONMENT=${environment}\n`);
    Log.log(`Environment variables for ${environment} have been loaded.`);
    if (secretVariables.length > 0) {
      Log.addNewLineIfNone();
      Log.warn(
        `Some variables are not available for reading. You can edit them in ${envLocalFile} manually.`
      );
      Log.warn(`Variables that are not available for reading: ${secretVariables.join(', ')}.`);
      Log.addNewLineIfNone();
    }
  }
}
