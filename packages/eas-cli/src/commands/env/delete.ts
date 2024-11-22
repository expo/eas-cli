import { Flags } from '@oclif/core';
import assert from 'assert';
import chalk from 'chalk';

import EasCommand from '../../commandUtils/EasCommand';
import {
  EASEnvironmentVariableScopeFlag,
  EASEnvironmentVariableScopeFlagValue,
  EASNonInteractiveFlag,
  EasEnvironmentFlagParameters,
} from '../../commandUtils/flags';
import { EnvironmentVariableEnvironment, EnvironmentVariableScope } from '../../graphql/generated';
import { EnvironmentVariableMutation } from '../../graphql/mutations/EnvironmentVariableMutation';
import { EnvironmentVariablesQuery } from '../../graphql/queries/EnvironmentVariablesQuery';
import Log from '../../log';
import { promptAsync, toggleConfirmAsync } from '../../prompts';
import { formatVariableName, isEnvironment } from '../../utils/variableUtils';

interface DeleteFlags {
  'variable-name'?: string;
  'variable-environment'?: EnvironmentVariableEnvironment;
  'non-interactive': boolean;
  scope: EnvironmentVariableScope;
}

interface RawDeleteFlags {
  'variable-name'?: string;
  'variable-environment'?: EnvironmentVariableEnvironment;
  'non-interactive': boolean;
  scope: EASEnvironmentVariableScopeFlagValue;
}

export default class EnvDelete extends EasCommand {
  static override description = 'delete an environment variable for the current project or account';

  static override flags = {
    'variable-name': Flags.string({
      description: 'Name of the variable to delete',
    }),
    'variable-environment': Flags.enum<EnvironmentVariableEnvironment>({
      ...EasEnvironmentFlagParameters,
      description: 'Current environment of the variable to delete',
    }),
    ...EASEnvironmentVariableScopeFlag,
    ...EASNonInteractiveFlag,
  };

  static override args = [
    {
      name: 'environment',
      description:
        "Current environment of the variable to delete. One of 'production', 'preview', or 'development'.",
      required: false,
    },
  ];

  static override contextDefinition = {
    ...this.ContextOptions.ProjectId,
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const { args, flags } = await this.parse(EnvDelete);
    const {
      'variable-name': name,
      'variable-environment': environment,
      'non-interactive': nonInteractive,
      scope,
    } = this.sanitizeInputs(flags, args);
    const {
      projectId,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(EnvDelete, {
      nonInteractive,
    });

    const variables =
      scope === EnvironmentVariableScope.Project
        ? await EnvironmentVariablesQuery.byAppIdAsync(graphqlClient, {
            appId: projectId,
            environment,
          })
        : await EnvironmentVariablesQuery.sharedAsync(graphqlClient, {
            appId: projectId,
            environment,
          });

    let selectedVariable;

    if (!name) {
      ({ variable: selectedVariable } = await promptAsync({
        type: 'select',
        name: 'variable',
        message: 'Pick the variable to be deleted:',
        choices: variables
          .filter(({ scope: variableScope }) => scope === variableScope)
          .map(variable => {
            return {
              title: formatVariableName(variable),
              value: variable,
            };
          }),
      }));
    } else {
      const selectedVariables = variables.filter(
        variable =>
          variable.name === name && (!environment || variable.environments?.includes(environment))
      );

      if (selectedVariables.length !== 1) {
        if (selectedVariables.length === 0) {
          throw new Error(`Variable "${name}" not found.`);
        } else {
          throw new Error(
            `Multiple variables with name "${name}" found. Please select the variable to delete interactively or run command with --variable-environment ENVIRONMENT option.`
          );
        }
      }

      selectedVariable = selectedVariables[0];
    }

    assert(selectedVariable, `Variable "${name}" not found.`);

    if (!nonInteractive) {
      Log.addNewLineIfNone();
      Log.warn(`You are about to permanently delete variable ${selectedVariable.name}.`);
      Log.warn('This action is irreversible.');
      Log.newLine();
      const confirmed = await toggleConfirmAsync({
        message: `Are you sure you wish to proceed?${
          selectedVariable.scope === EnvironmentVariableScope.Shared
            ? ' This variable is applied across your whole account and may affect multiple apps.'
            : ''
        }`,
      });
      if (!confirmed) {
        Log.error(`Canceled deletion of variable ${selectedVariable.name}.`);
        throw new Error(`Variable "${selectedVariable.name}" not deleted.`);
      }
    }

    await EnvironmentVariableMutation.deleteAsync(graphqlClient, selectedVariable.id);

    Log.withTick(`️Deleted variable ${selectedVariable.name}".`);
  }

  private sanitizeInputs(
    flags: RawDeleteFlags,
    { environment }: { environment?: string }
  ): DeleteFlags {
    if (flags['non-interactive']) {
      if (!flags['variable-name']) {
        throw new Error(
          `Environment variable needs 'name' to be specified when running in non-interactive mode. Run the command with ${chalk.bold(
            '--variable-name VARIABLE_NAME'
          )} flag to fix the issue`
        );
      }
    }

    const scope =
      flags.scope === 'account'
        ? EnvironmentVariableScope.Shared
        : EnvironmentVariableScope.Project;

    if (environment) {
      environment = environment.toUpperCase();

      if (!isEnvironment(environment)) {
        throw new Error(
          "Invalid environment. Use one of 'production', 'preview', or 'development'."
        );
      }
      return { ...flags, 'variable-environment': environment, scope };
    }

    return { ...flags, scope };
  }
}
