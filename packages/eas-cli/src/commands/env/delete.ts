import { Flags } from '@oclif/core';
import chalk from 'chalk';

import EasCommand from '../../commandUtils/EasCommand';
import {
  EASEnvironmentFlag,
  EASNonInteractiveFlag,
  EASVariableScopeFlag,
} from '../../commandUtils/flags';
import { EnvironmentVariableScope } from '../../graphql/generated';
import { EnvironmentVariableMutation } from '../../graphql/mutations/EnvironmentVariableMutation';
import { EnvironmentVariablesQuery } from '../../graphql/queries/EnvironmentVariablesQuery';
import Log from '../../log';
import { promptAsync, toggleConfirmAsync } from '../../prompts';
import { promptVariableEnvironmentAsync } from '../../utils/prompts';

export default class EnvironmentVariableDelete extends EasCommand {
  static override description = 'delete an environment variable by name';

  static override hidden = true;

  static override flags = {
    name: Flags.string({
      description: 'Name of the variable to delete',
    }),
    ...EASVariableScopeFlag,
    ...EASEnvironmentFlag,
    ...EASNonInteractiveFlag,
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectConfig,
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    let {
      flags: { name, environment, 'non-interactive': nonInteractive, scope },
    } = await this.parse(EnvironmentVariableDelete);
    const {
      privateProjectConfig: { projectId },
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(EnvironmentVariableDelete, {
      nonInteractive,
    });

    if (scope === EnvironmentVariableScope.Project) {
      if (!environment) {
        environment = await promptVariableEnvironmentAsync(nonInteractive);
      }
    }

    const variables =
      scope === EnvironmentVariableScope.Project && environment
        ? (await EnvironmentVariablesQuery.byAppIdAsync(graphqlClient, projectId, environment))
            .appVariables
        : await EnvironmentVariablesQuery.sharedAsync(graphqlClient, projectId);

    if (!name) {
      if (nonInteractive) {
        throw new Error(
          `Environment variable needs 'name' to be specified when running in non-interactive mode. Run the command with ${chalk.bold(
            '--name VARIABLE_NAME'
          )} flag to fix the issue`
        );
      }

      ({ name } = await promptAsync({
        type: 'select',
        name: 'name',
        message: 'Pick the variable to be deleted:',
        choices: variables.map(variable => ({
          title: variable.name,
          value: variable.name,
        })),
      }));

      if (!name) {
        throw new Error(
          `Environment variable wasn't selected. Run the command again and selected existing variable or run it with ${chalk.bold(
            '--name VARIABLE_NAME'
          )} flag to fix the issue.`
        );
      }
    }

    const selectedVariable = variables.find(variable => variable.name === name);

    if (!selectedVariable) {
      throw new Error(`Variable "${name}" not found.`);
    }

    if (!nonInteractive) {
      Log.addNewLineIfNone();
      Log.warn(
        `You are about to permanently delete variable ${selectedVariable.name}.\nThis action is irreversible.`
      );
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
        return;
      }
    }

    await EnvironmentVariableMutation.deleteAsync(graphqlClient, selectedVariable.id);

    Log.withTick(`️Deleted variable ${selectedVariable.name}".`);
  }
}
