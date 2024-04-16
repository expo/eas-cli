import { Flags } from '@oclif/core';
import fs from 'fs-extra';

import EasCommand from '../../commandUtils/EasCommand';
import { EASEnvironmentFlag } from '../../commandUtils/flags';
import {
  EnvironmentVariableFragment,
  EnvironmentVariableScope,
  EnvironmentVariableVisibility,
} from '../../graphql/generated';
import {
  EnvironmentVariableMutation,
  EnvironmentVariablePushInput,
} from '../../graphql/mutations/EnvironmentVariableMutation';
import { EnvironmentVariablesQuery } from '../../graphql/queries/EnvironmentVariablesQuery';
import Log from '../../log';
import { promptAsync } from '../../prompts';

export default class EnvironmentValuePush extends EasCommand {
  static override description = 'push env file';

  static override contextDefinition = {
    ...this.ContextOptions.ProjectConfig,
    ...this.ContextOptions.LoggedIn,
  };

  static override flags = {
    ...EASEnvironmentFlag,
    path: Flags.string({
      description: 'Path to the env file',
      default: '.env.local',
    }),
  };

  async runAsync(): Promise<void> {
    const {
      flags: { environment, path: envPath },
    } = await this.parse(EnvironmentValuePush);
    const {
      privateProjectConfig: { projectId },
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(EnvironmentValuePush, {
      nonInteractive: true,
    });

    if (!environment) {
      throw new Error('Please provide an environment to push the env file to.');
    }

    const updateVariables: Record<string, EnvironmentVariablePushInput> =
      await this.parseEnvFileAsync(envPath, environment);

    const variableNames = Object.keys(updateVariables);

    const { appVariables: existingVariables } = await EnvironmentVariablesQuery.byAppIdAsync(
      graphqlClient,
      { appId: projectId, environment, filterNames: variableNames }
    );

    // Check if any of the variables already exist in the environment. Prompt the user to overwrite them.
    const existingSensitiveVariables = existingVariables.filter(
      variable => variable.value === null
    );

    if (existingSensitiveVariables.length > 0) {
      const existingSensitiveVariablesNames = existingSensitiveVariables.map(
        variable => variable.name
      );
      Log.log(
        'Sensitive variables cannot be overwritten with `push` command.\nUse `eas env:update` to change them:'
      );
      existingSensitiveVariablesNames.forEach(name => Log.log(`- ${name}`));
    }

    const existingDifferentVariables: EnvironmentVariableFragment[] = [];
    // Remove variables that are the same as the ones in the environment or sensitive.
    existingVariables.forEach(variable => {
      const existingVariableUpdate = updateVariables[variable.name];
      if (
        existingVariableUpdate &&
        existingVariableUpdate.value !== variable.value &&
        variable.value !== null
      ) {
        existingDifferentVariables.push(variable);
      } else {
        delete updateVariables[variable.name];
      }
    });

    const existingDifferentSharedVariables = existingDifferentVariables.filter(
      variable => variable.scope === EnvironmentVariableScope.Shared
    );

    if (existingDifferentSharedVariables.length > 0) {
      const existingDifferentSharedVariablesNames = existingDifferentSharedVariables.map(
        variable => variable.name
      );
      Log.error(
        'Shared variables cannot be overwritten.\nPlease remove them from the env file or unlink them from the project:'
      );
      existingDifferentSharedVariablesNames.forEach(name => Log.error(`- ${name}`));
      return;
    }

    if (existingDifferentVariables.length > 0) {
      Log.warn('Some variables already exist in the environment.');

      const { variablesToOverwrite } = await promptAsync({
        type: 'multiselect',
        name: 'variablesToOverwrite',
        message: 'Select variables to overwrite:',
        // @ts-expect-error property missing from `@types/prompts`
        optionsPerPage: 20,
        choices: existingDifferentVariables.map(variable => ({
          title: `${variable.name}: ${updateVariables[variable.name].value}`,
          value: variable.name,
        })),
      });

      for (const existingVariable of existingVariables) {
        const name = existingVariable.name;
        if (variablesToOverwrite.includes(name)) {
          updateVariables[name]['overwrite'] = true;
        } else {
          delete updateVariables[name];
        }
      }
    }

    const variablesToPush = Object.values(updateVariables);

    if (variablesToPush.length === 0) {
      Log.log('No new variables to push.');
      return;
    }

    await EnvironmentVariableMutation.createBulkEnvironmentVariablesForAppAsync(
      graphqlClient,
      variablesToPush,
      projectId
    );

    Log.log(`Uploaded env file to ${environment} environment.`);
  }

  private async parseEnvFileAsync(
    envPath: string,
    environment: string
  ): Promise<Record<string, EnvironmentVariablePushInput>> {
    if (!(await fs.exists(envPath))) {
      throw new Error(`File ${envPath} does not exist.`);
    }
    const variables: Record<string, EnvironmentVariablePushInput> = {};
    const content = await fs.readFile(envPath, 'utf8');

    content
      .trim()
      .split('\n')
      .filter(line => !line.startsWith('#') && line.includes('='))
      .forEach(line => {
        const [name, value] = line.split('=');
        if (name && value && name.match(/^\w+$/)) {
          const visibility = name.startsWith('EXPO_SECRET')
            ? EnvironmentVariableVisibility.Sensitive
            : EnvironmentVariableVisibility.Public;
          variables[name] = {
            name,
            value,
            environment,
            visibility,
          };
        }
      });
    return variables;
  }
}
