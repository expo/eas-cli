import assert from 'assert';
import * as fs from 'fs-extra';
import { exists } from 'fs-extra';

import { withSudoModeAsync } from '../../authUtils';
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
    ...this.ContextOptions.SessionManagment,
  };

  async runAsync(): Promise<void> {
    const {
      flags: { environment, 'non-interactive': nonInteractive },
    } = await this.parse(EnvironmentVariableLoad);

    const {
      privateProjectConfig: { projectId },
      loggedIn: { graphqlClient },
      sessionManager,
    } = await this.getContextAsync(EnvironmentVariableLoad, {
      nonInteractive,
    });

    assert(environment, 'Environment is required');

    if ((await exists(EnvLocalFile)) && !(await exists(EnvOriginalLocalFile))) {
      await fs.rename(EnvLocalFile, EnvOriginalLocalFile);
    }
    Log.log('Pulling environment variables...');

    const environmentVariables = await withSudoModeAsync(sessionManager, async () => {
      assert(environment);
      return await EnvironmentVariablesQuery.byAppIdWithSensitiveAsync(graphqlClient, {
        appId: projectId,
        environment,
      });
    });

    const envFileContent = environmentVariables
      .filter((variable: EnvironmentVariableFragment) => variable.value !== null)
      .map((variable: EnvironmentVariableFragment) => {
        return `${variable.name}=${variable.value}`;
      })
      .join('\n');
    await fs.writeFile(EnvLocalFile, envFileContent);
    Log.log(`Environment variables for ${environment} have been loaded.`);
  }
}
