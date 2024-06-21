import { Flags } from '@oclif/core';

import EasCommand from '../../commandUtils/EasCommand';
import {
  EASEnvironmentFlag,
  EASNonInteractiveFlag,
  EASVariableScopeFlag,
  EASVariableSensitiveFlag,
} from '../../commandUtils/flags';
import { promptVariableEnvironmentAsync } from '../../environment-variables/prompts';
import { EnvironmentVariableScope } from '../../graphql/generated';
import { EnvironmentVariableMutation } from '../../graphql/mutations/EnvironmentVariableMutation';
import { EnvironmentVariablesQuery } from '../../graphql/queries/EnvironmentVariablesQuery';
import Log from '../../log';
import { promptAsync, toggleConfirmAsync } from '../../prompts';

export default class EnvironmentVariableDelete extends EasCommand {
  static override description = 'delete an environment variable by name';

  static override flags = {
    name: Flags.string({
      description: 'Name of the variable to delete',
    }),
    ...EASVariableSensitiveFlag,
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

      if (!environment) {
        throw new Error('Environment is required.');
      }
    }

    const variables =
      scope === EnvironmentVariableScope.Project && environment
        ? (await EnvironmentVariablesQuery.byAppIdAsync(graphqlClient, projectId, environment))
            .appVariables
        : await EnvironmentVariablesQuery.sharedAsync(graphqlClient, projectId);

    if (!name) {
      const validationMessage = 'Variable name to delete may not be empty.';
      if (nonInteractive) {
        throw new Error(validationMessage);
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
        throw new Error(validationMessage);
      }
    }

    const selectedVariable = variables.find(variable => variable.name === name);

    if (!selectedVariable) {
      throw new Error(`Variable "${name}" not found.`);
    }

    if (!nonInteractive) {
      Log.addNewLineIfNone();
      Log.warn(
        `You are about to permanently delete variable ${selectedVariable.name} .\nThis action is irreversible.`
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
        process.exit(1);
      }
    }

    await EnvironmentVariableMutation.deleteAsync(graphqlClient, selectedVariable.id);

    Log.withTick(`️Deleted variable ${selectedVariable.name}".`);
  }
}
