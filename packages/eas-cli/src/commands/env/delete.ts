import { Flags } from '@oclif/core';

import EasCommand from '../../commandUtils/EasCommand';
import {
  EASEnvironmentFlag,
  EASNonInteractiveFlag,
  EASVariableScopeFlag,
  EASVariableSensitiveFlag,
} from '../../commandUtils/flags';
import { EnvironmentVariableScope } from '../../graphql/generated';
import { EnvironmentVariableMutation } from '../../graphql/mutations/EnvironmentVariableMutation';
import { EnvironmentVariablesQuery } from '../../graphql/queries/EnvironmentVariablesQuery';
import Log from '../../log';
import { promptAsync, toggleConfirmAsync } from '../../prompts';
import { promptVariableEnvironmentAsync } from '../../utils/prompts';

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
    let variable;
    let variables;

    if (scope === EnvironmentVariableScope.Project) {
      if (!environment) {
        environment = await promptVariableEnvironmentAsync(nonInteractive);
      }

      variables = (
        await EnvironmentVariablesQuery.byAppIdAsync(graphqlClient, projectId, environment)
      ).appVariables;
    } else {
      variables = await EnvironmentVariablesQuery.sharedAsync(graphqlClient, projectId);
    }

    if (!name) {
      const validationMessage = 'Variable name to delete may not be empty.';
      if (nonInteractive) {
        throw new Error(validationMessage);
      }

      ({ variable } = await promptAsync({
        type: 'autocomplete',
        name: 'variable',
        message: 'Pick the variable to be deleted:',
        choices: variables.map(variable => ({
          title: variable.name,
          value: variable,
        })),
      }));

      name = variable?.name;

      if (!name) {
        throw new Error(validationMessage);
      }
    }

    if (!variable) {
      throw new Error(`Variable "${name}" not found.`);
    }

    if (!nonInteractive) {
      Log.addNewLineIfNone();
      Log.warn(
        `You are about to permanently delete variable ${variable.name} .\nThis action is irreversible.`
      );
      Log.newLine();
      const confirmed = await toggleConfirmAsync({
        message: `Are you sure you wish to proceed?${
          variable.scope === EnvironmentVariableScope.Shared
            ? ' This variable is applied across your whole account and may affect multiple apps.'
            : ''
        }`,
      });
      if (!confirmed) {
        Log.error(`Canceled deletion of variable ${variable.name}.`);
        process.exit(1);
      }
    }

    await EnvironmentVariableMutation.deleteAsync(graphqlClient, variable.id);

    Log.withTick(`️Deleted variable ${variable.name}".`);
  }
}
