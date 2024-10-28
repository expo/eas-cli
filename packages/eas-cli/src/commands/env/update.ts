import { Flags } from '@oclif/core';
import assert from 'assert';
import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';

import EasCommand from '../../commandUtils/EasCommand';
import {
  EASEnvironmentArg,
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
  parseVisibility,
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
  visibility?: 'plaintext' | 'sensitive' | 'encrypted';
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

  static override args = [EASEnvironmentArg];

  static override contextDefinition = {
    ...this.ContextOptions.ProjectId,
    ...this.ContextOptions.Analytics,
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const {
      args: { environment },
      flags,
    } = await this.parse(EnvironmentVariableUpdate);
    const {
      name,
      value: rawValue,
      scope,
      'variable-name': currentName,
      'variable-environment': variableEnvironment,
      'non-interactive': nonInteractive,
      environment: environments,
      type,
      visibility,
    } = this.validateFlags(flags);

    const currentEnvironment = variableEnvironment?.toUpperCase() ?? environment?.toUpperCase();

    const {
      projectId,
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
          currentEnvironment ? `in environment ${currentEnvironment.toLocaleLowerCase()}` : ''
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
      fileName,
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
      fileName: newValue ? fileName : undefined,
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
  ): Promise<
    Omit<UpdateFlags, 'type' | 'visibility'> & {
      type?: EnvironmentSecretType;
      visibility?: EnvironmentVariableVisibility;
      fileName?: string;
    }
  > {
    let newType;
    let newVisibility: EnvironmentVariableVisibility | undefined;
    let fileName: string | undefined;

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

      if (!type && !value && !nonInteractive) {
        newType = await promptVariableTypeAsync(nonInteractive, selectedVariable.type);
      }

      if (!value) {
        value = await promptVariableValueAsync({
          nonInteractive,
          required: false,
          filePath: (newType ?? selectedVariable.type) === EnvironmentSecretType.FileBase64,
          initial:
            (newType ?? selectedVariable.type) === EnvironmentSecretType.FileBase64
              ? undefined
              : selectedVariable.value,
        });

        if (!value || value.length === 0 || value === selectedVariable.value) {
          value = undefined;
          newType = undefined;
        }
      }

      let environmentFilePath: string | undefined;

      if ((newType ?? selectedVariable.type) === EnvironmentSecretType.FileBase64 && value) {
        environmentFilePath = path.resolve(value);
        if (!(await fs.pathExists(environmentFilePath))) {
          throw new Error(`File "${value}" does not exist`);
        }
        fileName = path.basename(environmentFilePath);
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
        newVisibility = await promptVariableVisibilityAsync(
          nonInteractive,
          selectedVariable.visibility
        );

        if (!newVisibility || newVisibility === selectedVariable.visibility) {
          newVisibility = undefined;
        }
      }
    }

    if (visibility) {
      newVisibility = parseVisibility(visibility);
    }

    return {
      name,
      value,
      environment: environments,
      visibility: newVisibility,
      scope: rest.scope ?? EnvironmentVariableScope.Project,
      'non-interactive': nonInteractive,
      type: newType,
      fileName,
      ...rest,
    };
  }
}
