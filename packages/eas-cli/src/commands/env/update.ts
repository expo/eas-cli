import { Flags } from '@oclif/core';
import assert from 'assert';
import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';

import EasCommand from '../../commandUtils/EasCommand';
import {
  EASMultiEnvironmentFlag,
  EASNonInteractiveFlag,
  EASVariableScopeFlag,
  EASVariableVisibilityFlag,
  EasEnvironmentFlagParameters,
} from '../../commandUtils/flags';
import {
  EnvironmentSecretType,
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
  promptVariableTypeAsync,
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
  type?: 'string' | 'file';
  'variable-name'?: string;
  'variable-environment'?: EnvironmentVariableEnvironment;
  'non-interactive': boolean;
};

export default class EnvironmentVariableUpdate extends EasCommand {
  static override description =
    'update an environment variable on the current project or owner account';

  static override hidden = true;

  static override flags = {
    'variable-name': Flags.string({
      description: 'Current name of the variable',
    }),
    'variable-environment': Flags.enum<EnvironmentVariableEnvironment>({
      ...EasEnvironmentFlagParameters,
      description: 'Current environment of the variable to update',
    }),
    name: Flags.string({
      description: 'New name of the variable',
    }),
    value: Flags.string({
      description: 'New value or the variable',
    }),
    type: Flags.enum<'string' | 'file'>({
      description: 'The type of variable',
      options: ['string', 'file'],
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
    const {
      name,
      value: rawValue,
      scope,
      'variable-name': currentName,
      'variable-environment': currentEnvironment,
      'non-interactive': nonInteractive,
      environment: environments,
      type,
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
        environment: currentEnvironment,
        filterNames: currentName ? [currentName] : undefined,
      });
    }

    if (scope === EnvironmentVariableScope.Shared) {
      existingVariables = await EnvironmentVariablesQuery.sharedAsync(graphqlClient, {
        appId: projectId,
        environment: currentEnvironment,
        filterNames: currentName ? [currentName] : undefined,
      });
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

    const {
      name: newName,
      value: newValue,
      environment: newEnvironments,
      visibility: newVisibility,
      type: newType,
    } = await this.promptForMissingFlagsAsync(selectedVariable, {
      name,
      value: rawValue,
      environment: environments,
      visibility,
      'non-interactive': nonInteractive,
      type,
    });

    const variable = await EnvironmentVariableMutation.updateAsync(graphqlClient, {
      id: selectedVariable.id,
      name: newName,
      value: newValue,
      environments: newEnvironments,
      type: newType,
      visibility: newVisibility,
    });
    if (!variable) {
      throw new Error(`Could not update variable with name ${name} ${suffix}`);
    }

    Log.withTick(`Updated variable ${chalk.bold(selectedVariable.name)} ${suffix}.`);
  }
  private validateFlags(flags: UpdateFlags): UpdateFlags {
    if (flags['non-interactive']) {
      if (!flags['variable-name']) {
        throw new Error(
          'Current name is required in non-interactive mode. Run the command with --variable-name flag.'
        );
      }
      if (flags['type'] && !flags['value']) {
        throw new Error('Value is required when type is set. Run the command with --value flag.');
      }
    }

    return flags;
  }

  private async promptForMissingFlagsAsync(
    selectedVariable: EnvironmentVariableFragment,
    {
      name,
      value,
      environment: environments,
      visibility,
      'non-interactive': nonInteractive,
      type,
      ...rest
    }: UpdateFlags
  ): Promise<Omit<UpdateFlags, 'type'> & { type?: EnvironmentSecretType }> {
    let newType;

    if (type === 'file') {
      newType = EnvironmentSecretType.FileBase64;
    } else if (type === 'string') {
      newType = EnvironmentSecretType.String;
    }

    if (!nonInteractive) {
      if (!name) {
        name = await promptVariableNameAsync(nonInteractive, selectedVariable.name);

        if (!name || name.length === 0) {
          name = undefined;
        }
      }

      Log.log(
        selectedVariable.type,
        EnvironmentSecretType.String === selectedVariable.type,
        EnvironmentSecretType.FileBase64 === selectedVariable.type
      );
      if (!type && !value && !nonInteractive) {
        newType = await promptVariableTypeAsync(nonInteractive, selectedVariable.type);

        if (!newType || newType === selectedVariable.type) {
          newType = undefined;
        }
      }

      if (!value) {
        value = await promptVariableValueAsync({
          nonInteractive,
          required: false,
          initial:
            (newType ?? selectedVariable.type) === EnvironmentSecretType.FileBase64
              ? undefined
              : selectedVariable.value,
        });

        if (!value || value.length === 0 || value === selectedVariable.value) {
          value = undefined;
        }
      }

      let environmentFilePath: string | undefined;

      if (newType === EnvironmentSecretType.FileBase64 && value) {
        environmentFilePath = path.resolve(value);
        if (!(await fs.pathExists(environmentFilePath))) {
          throw new Error(`File "${value}" does not exist`);
        }
      }

      value = environmentFilePath ? await fs.readFile(environmentFilePath, 'base64') : value;

      if (!environments || environments.length === 0) {
        environments = await promptVariableEnvironmentAsync({
          nonInteractive,
          multiple: true,
          selectedEnvironments: selectedVariable.environments ?? [],
        });

        if (
          !environments ||
          environments.length === 0 ||
          environments === selectedVariable.environments
        ) {
          environments = undefined;
        }
      }

      if (!visibility) {
        visibility = await promptVariableVisibilityAsync(
          nonInteractive,
          selectedVariable.visibility
        );

        if (!visibility || visibility === selectedVariable.visibility) {
          visibility = undefined;
        }
      }
    }

    return {
      name,
      value,
      environment: environments,
      visibility,
      scope: rest.scope ?? EnvironmentVariableScope.Project,
      'non-interactive': nonInteractive,
      type: newType,
      ...rest,
    };
  }
}
