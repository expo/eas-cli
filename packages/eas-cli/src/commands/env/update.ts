import { Flags } from '@oclif/core';
import assert from 'assert';
import chalk from 'chalk';

import EasCommand from '../../commandUtils/EasCommand';
import {
  EASMultiEnvironmentFlag,
  EASNonInteractiveFlag,
  EASVariableScopeFlag,
  EASVariableVisibilityFlag,
  EasEnvironmentFlagParameters,
} from '../../commandUtils/flags';
import {
  EnvironmentVariableEnvironment,
  EnvironmentVariableFragment,
  EnvironmentVariableScope,
  EnvironmentVariableVisibility,
} from '../../graphql/generated';
import { EnvironmentVariableMutation } from '../../graphql/mutations/EnvironmentVariableMutation';
import { EnvironmentVariablesQuery } from '../../graphql/queries/EnvironmentVariablesQuery';
import Log from '../../log';
import {
  getDisplayNameForProjectIdAsync,
  getOwnerAccountForProjectIdAsync,
} from '../../project/projectUtils';
import { selectAsync } from '../../prompts';
import {
  promptVariableEnvironmentAsync,
  promptVariableNameAsync,
  promptVariableValueAsync,
  promptVariableVisibilityAsync,
} from '../../utils/prompts';
import { formatVariableName } from '../../utils/variableUtils';

type UpdateFlags = {
  name?: string;
  value?: string;
  scope?: EnvironmentVariableScope;
  environment?: EnvironmentVariableEnvironment[];
  visibility?: EnvironmentVariableVisibility;
  'current-name'?: string;
  'current-environment'?: EnvironmentVariableEnvironment;
  'non-interactive': boolean;
};

export default class EnvironmentVariableUpdate extends EasCommand {
  static override description =
    'update an environment variable on the current project or owner account';

  static override hidden = true;

  static override flags = {
    'current-name': Flags.string({
      description: 'Current name of the variable',
    }),
    'current-environment': Flags.enum<EnvironmentVariableEnvironment>({
      ...EasEnvironmentFlagParameters,
      description: 'Current environment of the variable',
    }),
    name: Flags.string({
      description: 'New name of the variable',
    }),
    value: Flags.string({
      description: 'New value or the variable',
    }),
    ...EASVariableVisibilityFlag,
    ...EASVariableScopeFlag,
    ...EASMultiEnvironmentFlag,
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
      'current-name': currentName,
      'current-environment': currentEnvironment,
      'non-interactive': nonInteractive,
      environment: environments,
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

    let selectedVariable: EnvironmentVariableFragment;
    let existingVariables: EnvironmentVariableFragment[] = [];
    const suffix =
      scope === EnvironmentVariableScope.Project
        ? `on project ${projectDisplayName}`
        : `on account ${ownerAccount.name}`;

    if (scope === EnvironmentVariableScope.Project) {
      existingVariables = await EnvironmentVariablesQuery.byAppIdAsync(graphqlClient, {
        appId: projectId,
        filterNames: currentName ? [currentName] : undefined,
      });
    }

    if (scope === EnvironmentVariableScope.Shared) {
      existingVariables = await EnvironmentVariablesQuery.sharedAsync(graphqlClient, {
        appId: projectId,
        filterNames: currentName ? [currentName] : undefined,
      });
    }

    if (currentEnvironment) {
      existingVariables = existingVariables.filter(
        variable => variable.environments?.some(env => env === currentEnvironment)
      );
    }

    if (existingVariables.length === 0) {
      throw new Error(
        `Variable with name ${currentName} ${
          currentEnvironment ? `in environment ${currentEnvironment}` : ''
        } does not exist ${suffix}.`
      );
    } else if (existingVariables.length > 1) {
      selectedVariable = await selectAsync(
        'Select variable',
        existingVariables.map(variable => ({
          title: formatVariableName(variable),
          value: variable,
        }))
      );
    } else {
      selectedVariable = existingVariables[0];
    }

    assert(selectedVariable, 'Variable must be selected');
    if (!nonInteractive) {
      if (!name) {
        name = await promptVariableNameAsync(nonInteractive, selectedVariable.name);
        if (!name || name.length === 0) {
          name = undefined;
        }
      }

      if (!value) {
        value = await promptVariableValueAsync({
          nonInteractive,
          required: false,
          initial: selectedVariable.value,
        });
        if (!value || value.length === 0) {
          value = undefined;
        }
      }

      if (!environments || environments.length === 0) {
        environments = await promptVariableEnvironmentAsync({
          nonInteractive,
          multiple: true,
          selectedEnvironments: selectedVariable.environments ?? [],
        });
      }

      if (!visibility) {
        visibility = await promptVariableVisibilityAsync(
          nonInteractive,
          selectedVariable.visibility
        );
      }
    }

    const variable = await EnvironmentVariableMutation.updateAsync(graphqlClient, {
      id: selectedVariable.id,
      name,
      value,
      environments,
      visibility,
    });
    if (!variable) {
      throw new Error(`Could not update variable with name ${name} ${suffix}`);
    }

    Log.withTick(`Updated variable ${chalk.bold(selectedVariable.name)} ${suffix}.`);
  }
  private validateFlags(flags: UpdateFlags): UpdateFlags {
    if (flags['non-interactive']) {
      if (!flags['current-name']) {
        throw new Error(
          'Current name is required in non-interactive mode. Run the command with --current-name flag.'
        );
      }
    }

    return flags;
  }
}
