import { Flags } from '@oclif/core';
import assert from 'assert';
import dotenv from 'dotenv';
import fs from 'fs-extra';

import EasCommand from '../../commandUtils/EasCommand';
import { EASEnvironmentFlag } from '../../commandUtils/flags';
import {
  EnvironmentVariableEnvironment,
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
import { confirmAsync, promptAsync } from '../../prompts';

type PushFlags = {
  environment?: EnvironmentVariableEnvironment;
  path: string;
};

export default class EnvironmentVariablePush extends EasCommand {
  static override description = 'push env file';

  static override hidden = true;

  static override contextDefinition = {
    ...this.ContextOptions.ProjectConfig,
    ...this.ContextOptions.LoggedIn,
  };

  static override flags = {
    ...EASEnvironmentFlag,
    path: Flags.string({
      description: 'Path to the input `.env` file',
      default: '.env.local',
    }),
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(EnvironmentVariablePush);

    const { environment, path: envPath } = this.validateFlags(flags);
    const {
      privateProjectConfig: { projectId },
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(EnvironmentVariablePush, {
      nonInteractive: false,
    });

    const updateVariables: Record<string, EnvironmentVariablePushInput> =
      await this.parseEnvFileAsync(envPath, environment);

    const variableNames = Object.keys(updateVariables);

    const existingVariables = await EnvironmentVariablesQuery.byAppIdAsync(graphqlClient, {
      appId: projectId,
      environment,
      filterNames: variableNames,
    });

    const existingDifferentVariables: EnvironmentVariableFragment[] = [];
    // Remove variables that are the same as the ones in the environment
    existingVariables.forEach(variable => {
      const existingVariableUpdate = updateVariables[variable.name];
      if (existingVariableUpdate && existingVariableUpdate.value !== variable.value) {
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
      Log.error('Shared variables cannot be overwritten by eas env:push command.');
      Log.error('Remove them from the env file or unlink them from the project to continue:');
      existingDifferentSharedVariablesNames.forEach(name => {
        Log.error(`- ${name}`);
      });
      throw new Error('Shared variables cannot be overwritten by eas env:push command');
    }

    if (existingDifferentVariables.length > 0) {
      Log.warn('Some variables already exist in the environment.');
      const variableNames = existingDifferentVariables.map(variable => variable.name);

      const confirmationMessage =
        variableNames.length > 1
          ? `The ${variableNames.join(
              ', '
            )} environment variables already exist in ${environment} environment. Do you want to override them all?`
          : `The ${variableNames[0]} environment variable already exists in ${environment} environment. Do you want to override it?`;

      const confirm = await confirmAsync({
        message: confirmationMessage,
      });

      let variablesToOverwrite: string[] = [];

      if (!confirm && existingDifferentVariables.length === 1) {
        throw new Error('No new variables to push.');
      }

      if (confirm) {
        variablesToOverwrite = existingDifferentVariables.map(variable => variable.name);
      } else {
        const promptResult = await promptAsync({
          type: 'multiselect',
          name: 'variablesToOverwrite',
          message: 'Select variables to overwrite:',
          // @ts-expect-error property missing from `@types/prompts`
          optionsPerPage: 20,
          choices: existingDifferentVariables.map(variable => ({
            title: `${variable.name}: ${updateVariables[variable.name].value} (was ${
              variable.value ?? '(secret)'
            })`,
            value: variable.name,
          })),
        });
        variablesToOverwrite = promptResult.variablesToOverwrite;
      }

      for (const existingVariable of existingVariables) {
        const name = existingVariable.name;
        if (variablesToOverwrite.includes(name)) {
          updateVariables[name]['overwrite'] = true;
        } else {
          delete updateVariables[name];
        }
      }
    }

    // Check if any of the sensitive variables already exist in the environment. Prompt the user to overwrite them.
    const existingSensitiveVariables = existingVariables.filter(
      variable => variable.value === null
    );

    if (existingSensitiveVariables.length > 0) {
      const existingSensitiveVariablesNames = existingSensitiveVariables.map(
        variable => `- ${variable.name}`
      );
      const confirm = await confirmAsync({
        message: `You are about to overwrite sensitive variables.\n${existingSensitiveVariablesNames.join(
          '\n'
        )}\n Do you want to continue?`,
      });
      if (!confirm) {
        throw new Error('Aborting...');
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
    const pushInput: Record<string, EnvironmentVariablePushInput> = {};

    const variables: Record<string, string> = dotenv.parse(await fs.readFile(envPath, 'utf8'));

    for (const [name, value] of Object.entries(variables)) {
      pushInput[name] = {
        name,
        value,
        environment,
        visibility: name.startsWith('EXPO_SENSITIVE')
          ? EnvironmentVariableVisibility.Sensitive
          : EnvironmentVariableVisibility.Public,
      };
    }

    return pushInput;
  }

  private validateFlags(flags: PushFlags): Required<PushFlags> {
    if (!flags.environment) {
      throw new Error('Please provide an environment to push the env file to.');
    }

    return { ...flags, environment: flags.environment };
  }
}
