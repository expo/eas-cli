import { Flags } from '@oclif/core';
import dotenv from 'dotenv';
import fs from 'fs-extra';
import path from 'path';

import EasCommand from '../../commandUtils/EasCommand';
import { EASMultiEnvironmentFlag } from '../../commandUtils/flags';
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
import { promptVariableEnvironmentAsync } from '../../utils/prompts';
import { isEnvironment } from '../../utils/variableUtils';

export default class EnvPush extends EasCommand {
  static override description =
    'push environment variables from .env file to the selected environment';

  static override contextDefinition = {
    ...this.ContextOptions.ProjectId,
    ...this.ContextOptions.LoggedIn,
  };

  static override flags = {
    ...EASMultiEnvironmentFlag,
    path: Flags.string({
      description: 'Path to the input `.env` file',
      default: '.env.local',
    }),
  };

  static override args = [
    {
      name: 'environment',
      description:
        "Environment to push variables to. One of 'production', 'preview', or 'development'.",
      required: false,
    },
  ];

  async runAsync(): Promise<void> {
    const { args, flags } = await this.parse(EnvPush);

    let { environment: environments, path: envPath } = this.parseFlagsAndArgs(flags, args);

    const {
      projectId,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(EnvPush, {
      nonInteractive: false,
    });

    if (!environments) {
      environments = await promptVariableEnvironmentAsync({
        nonInteractive: false,
        multiple: true,
      });
    }

    const updateVariables: Record<string, EnvironmentVariablePushInput> =
      await this.parseEnvFileAsync(envPath, environments);

    const variableNames = Object.keys(updateVariables);

    for (const environment of environments) {
      const displayedEnvironment = environment.toLocaleLowerCase();
      const existingVariables = await EnvironmentVariablesQuery.byAppIdAsync(graphqlClient, {
        appId: projectId,
        environment,
        filterNames: variableNames,
      });

      const existingDifferentVariables: EnvironmentVariableFragment[] = [];
      // Remove variables that are the same as the ones in the environment
      existingVariables.forEach(existingVariable => {
        const existingVariableUpdate = updateVariables[existingVariable.name];

        if (existingVariableUpdate) {
          const hasMoreEnvironments = existingVariableUpdate.environments.some(
            newEnv => !existingVariable.environments?.includes(newEnv)
          );

          if (existingVariableUpdate.value !== existingVariable.value || hasMoreEnvironments) {
            existingDifferentVariables.push(existingVariable);
          } else {
            delete updateVariables[existingVariable.name];
          }
        }
      });

      const existingDifferentSharedVariables = existingDifferentVariables.filter(
        variable => variable.scope === EnvironmentVariableScope.Shared
      );

      if (existingDifferentSharedVariables.length > 0) {
        const existingDifferentSharedVariablesNames = existingDifferentSharedVariables.map(
          variable => variable.name
        );
        Log.error('Account-wide variables cannot be overwritten by eas env:push command.');
        Log.error('Remove them from the env file or unlink them from the project to continue:');
        existingDifferentSharedVariablesNames.forEach(name => {
          Log.error(`- ${name}`);
        });
        throw new Error('Account-wide variables cannot be overwritten by eas env:push command');
      }

      if (existingDifferentVariables.length > 0) {
        Log.warn(`Some variables already exist in the ${displayedEnvironment} environment.`);
        const variableNames = existingDifferentVariables.map(variable => variable.name);

        const confirmationMessage =
          variableNames.length > 1
            ? `The ${variableNames.join(
                ', '
              )} environment variables already exist in ${displayedEnvironment} environment. Do you want to override them all?`
            : `The ${variableNames[0]} environment variable already exists in ${displayedEnvironment} environment. Do you want to override it?`;

        const confirm = await confirmAsync({
          message: confirmationMessage,
        });

        let variablesToOverwrite: string[] = [];

        if (!confirm && existingDifferentVariables.length === 0) {
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
        variable => variable.visibility !== EnvironmentVariableVisibility.Public
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
    Log.log(`Uploaded env file to ${environments.join(', ').toLocaleLowerCase()}.`);
  }

  parseFlagsAndArgs(
    flags: { path: string; environment: EnvironmentVariableEnvironment[] | undefined },
    { environment }: Record<string, string>
  ): { environment?: EnvironmentVariableEnvironment[]; path: string } {
    if (environment && !isEnvironment(environment.toUpperCase())) {
      throw new Error("Invalid environment. Use one of 'production', 'preview', or 'development'.");
    }

    const environments =
      flags.environment ??
      (environment ? [environment.toUpperCase() as EnvironmentVariableEnvironment] : undefined);

    return {
      ...flags,
      environment: environments,
    };
  }

  private async parseEnvFileAsync(
    envPath: string,
    environments: EnvironmentVariableEnvironment[]
  ): Promise<Record<string, EnvironmentVariablePushInput>> {
    if (!(await fs.exists(envPath))) {
      throw new Error(`File ${envPath} does not exist.`);
    }
    const pushInput: Record<string, EnvironmentVariablePushInput> = {};

    const variables: Record<string, string> = dotenv.parse(await fs.readFile(envPath, 'utf8'));

    const hasFileVariables = Object.values(variables).some(value =>
      value.includes(path.join('.eas', '.env'))
    );

    if (hasFileVariables) {
      Log.warn('File variables are not supported in this command.');
    }

    for (const [name, value] of Object.entries(variables)) {
      // Skip file variables
      const fileVariablePath = path.join('.eas', '.env', name);
      if (value.endsWith(fileVariablePath)) {
        Log.warn(`Skipping file variable ${name}`);
        continue;
      }
      pushInput[name] = {
        name,
        value,
        environments,
        visibility: name.startsWith('EXPO_SENSITIVE')
          ? EnvironmentVariableVisibility.Sensitive
          : EnvironmentVariableVisibility.Public,
      };
    }

    return pushInput;
  }
}
