import { Flags } from '@oclif/core';
import chalk from 'chalk';

import EasCommand from '../../commandUtils/EasCommand';
import {
  EASEnvironmentFlag,
  EASNonInteractiveFlag,
  EASVariableScopeFlag,
  EASVariableVisibilityFlag,
} from '../../commandUtils/flags';
import { EnvironmentVariableScope, EnvironmentVariableVisibility } from '../../graphql/generated';
import { EnvironmentVariableMutation } from '../../graphql/mutations/EnvironmentVariableMutation';
import { EnvironmentVariablesQuery } from '../../graphql/queries/EnvironmentVariablesQuery';
import Log from '../../log';
import {
  getDisplayNameForProjectIdAsync,
  getOwnerAccountForProjectIdAsync,
} from '../../project/projectUtils';
import { selectAsync } from '../../prompts';
import { promptVariableEnvironmentAsync, promptVariableValueAsync } from '../../utils/prompts';

type UpdateFlags = {
  name?: string;
  value?: string;
  scope?: EnvironmentVariableScope;
  environment?: string;
  visibility?: EnvironmentVariableVisibility;
  'non-interactive': boolean;
};

export default class EnvironmentVariableUpdate extends EasCommand {
  static override description =
    'update an environment variable on the current project or owner account';

  static override hidden = true;

  static override flags = {
    name: Flags.string({
      description: 'Name of the variable',
    }),
    value: Flags.string({
      description: 'Text value or the variable',
    }),
    ...EASVariableVisibilityFlag,
    ...EASVariableScopeFlag,
    ...EASEnvironmentFlag,
    ...EASNonInteractiveFlag,
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectConfig,
    ...this.ContextOptions.Analytics,
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(EnvironmentVariableUpdate);
    let {
      name,
      value,
      scope,
      'non-interactive': nonInteractive,
      environment,
      visibility,
    } = this.validateFlags(flags);

    const {
      privateProjectConfig: { projectId },
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(EnvironmentVariableUpdate, {
      nonInteractive,
    });

    const [projectDisplayName, ownerAccount] = await Promise.all([
      getDisplayNameForProjectIdAsync(graphqlClient, projectId),
      getOwnerAccountForProjectIdAsync(graphqlClient, projectId),
    ]);

    if (scope === EnvironmentVariableScope.Project) {
      if (!environment) {
        environment = await promptVariableEnvironmentAsync(nonInteractive);
      }
      const existingVariables = await EnvironmentVariablesQuery.byAppIdAsync(graphqlClient, {
        appId: projectId,
        environment,
      });
      if (!name) {
        name = await selectAsync(
          'Select variable',
          existingVariables.map(variable => ({
            title: variable.name,
            value: variable.name,
          }))
        );
      }

      const existingVariable = existingVariables.find(variable => variable.name === name);
      if (!existingVariable) {
        throw new Error(
          `Variable with name ${name} does not exist on project ${projectDisplayName}`
        );
      }

      if (!value) {
        value = await promptVariableValueAsync({
          nonInteractive,
          required: false,
          initial: existingVariable.value,
        });
        if (!value || value.length === 0) {
          value = '';
        }
      }

      const variable = await EnvironmentVariableMutation.createForAppAsync(
        graphqlClient,
        {
          name,
          value,
          environment,
          visibility,
          overwrite: true,
        },
        projectId
      );
      if (!variable) {
        throw new Error(
          `Could not update variable with name ${name} on project ${projectDisplayName}`
        );
      }

      Log.withTick(
        `Updated variable ${chalk.bold(name)} on project ${chalk.bold(projectDisplayName)}.`
      );
    } else if (scope === EnvironmentVariableScope.Shared) {
      const sharedVariables = await EnvironmentVariablesQuery.sharedAsync(graphqlClient, {
        appId: projectId,
      });

      if (!name) {
        name = await selectAsync(
          'Select variable',
          sharedVariables.map(variable => ({
            title: variable.name,
            value: variable.name,
          }))
        );
      }

      const existingVariable = sharedVariables.find(variable => variable.name === name);
      if (!existingVariable) {
        throw new Error(
          "Variable with this name  doesn't exist on this account. Use a different name."
        );
      }

      if (!value) {
        value = await promptVariableValueAsync({
          nonInteractive,
          required: false,
          initial: existingVariable.value,
        });
        if (!value || value.length === 0) {
          value = '';
        }
      }

      const variable = await EnvironmentVariableMutation.createSharedVariableAsync(
        graphqlClient,
        {
          name,
          value,
          visibility,
          overwrite: true,
        },
        ownerAccount.id
      );

      if (!variable) {
        throw new Error(
          `Could not update variable with name ${name} on account ${ownerAccount.name}`
        );
      }

      Log.withTick(
        `Updated shared variable ${chalk.bold(name)} on account ${chalk.bold(ownerAccount.name)}.`
      );
    }
  }
  private validateFlags(flags: UpdateFlags): UpdateFlags {
    if (flags['non-interactive']) {
      if (!flags.name) {
        throw new Error(
          'Variable name is required in non-interactive mode. Run the command with --name flag.'
        );
      }

      if (flags.scope === EnvironmentVariableScope.Project && !flags.environment) {
        throw new Error(
          'Environment is required when updating project-wide variable in non-interactive mode. Run the command with --environment flag.'
        );
      }
    }

    return flags;
  }
}
