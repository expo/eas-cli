import { Args, Flags } from '@oclif/core';
import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';

import EasCommand from '../../commandUtils/EasCommand';
import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import {
  EASEnvironmentVariableScopeFlag,
  EASEnvironmentVariableScopeFlagValue,
  EASMultiEnvironmentFlag,
  EASNonInteractiveFlag,
  EASVariableVisibilityFlag,
} from '../../commandUtils/flags';
import {
  EnvironmentSecretType,
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
import {
  parseVisibility,
  promptVariableEnvironmentAsync,
  promptVariableNameAsync,
  promptVariableTypeAsync,
  promptVariableValueAsync,
  promptVariableVisibilityAsync,
} from '../../utils/prompts';

interface RawSetFlags {
  name?: string;
  value?: string;
  type?: 'string' | 'file';
  visibility?: 'plaintext' | 'sensitive' | 'secret';
  scope: EASEnvironmentVariableScopeFlagValue;
  environment?: string[];
  'non-interactive': boolean;
}

interface SetFlags {
  name?: string;
  value?: string;
  type?: 'string' | 'file';
  visibility?: 'plaintext' | 'sensitive' | 'secret';
  scope: EnvironmentVariableScope;
  environment?: string[];
  'non-interactive': boolean;
}

export default class EnvSet extends EasCommand {
  static override description =
    'set (create or update) an environment variable on the current project or account';

  static override args = {
    environment: Args.string({
      description:
        "Environment to set the variable in. Default environments are 'production', 'preview', and 'development'.",
      required: false,
    }),
  };

  static override flags = {
    name: Flags.string({
      description: 'Name of the variable',
    }),
    value: Flags.string({
      description: 'Text value or the variable',
    }),
    type: Flags.option({
      description: 'The type of variable',
      options: ['string', 'file'] as const,
    })(),
    ...EASVariableVisibilityFlag,
    ...EASEnvironmentVariableScopeFlag,
    ...EASMultiEnvironmentFlag,
    ...EASNonInteractiveFlag,
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectId,
    ...this.ContextOptions.Analytics,
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const { args, flags } = await this.parse(EnvSet);

    const validatedFlags = this.sanitizeFlags(flags);

    const {
      projectId,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(EnvSet, {
      nonInteractive: validatedFlags['non-interactive'],
    });

    const {
      name,
      value,
      scope,
      environment: environments,
      visibility,
      type,
      fileName,
    } = await this.promptForMissingFlagsAsync(validatedFlags, args, {
      graphqlClient,
      projectId,
    });

    const [projectDisplayName, ownerAccount] = await Promise.all([
      getDisplayNameForProjectIdAsync(graphqlClient, projectId),
      getOwnerAccountForProjectIdAsync(graphqlClient, projectId),
    ]);

    if (scope === EnvironmentVariableScope.Project) {
      const existingVariables = await EnvironmentVariablesQuery.byAppIdAsync(graphqlClient, {
        appId: projectId,
        filterNames: [name],
      });

      const existingVariable = existingVariables.find(
        variable =>
          variable.scope === EnvironmentVariableScope.Project &&
          (!environments || variable.environments?.some(env => environments?.includes(env)))
      );

      const variable = existingVariable
        ? await EnvironmentVariableMutation.updateAsync(graphqlClient, {
            id: existingVariable.id,
            name,
            value,
            visibility,
            environments,
            type,
            fileName,
          })
        : await EnvironmentVariableMutation.createForAppAsync(
            graphqlClient,
            {
              name,
              value,
              environments,
              visibility,
              type: type ?? EnvironmentSecretType.String,
              fileName,
            },
            projectId
          );

      if (!variable) {
        throw new Error(
          `Could not set variable with name ${name} on project ${projectDisplayName}`
        );
      }

      Log.withTick(
        `${existingVariable ? 'Updated' : 'Created'} variable ${chalk.bold(name)} on project ${chalk.bold(
          projectDisplayName
        )}.`
      );
    } else if (scope === EnvironmentVariableScope.Shared) {
      const existingVariables = await EnvironmentVariablesQuery.sharedAsync(graphqlClient, {
        appId: projectId,
        filterNames: [name],
      });

      const existingVariable = existingVariables.find(
        variable => !environments || variable.environments?.some(env => environments?.includes(env))
      );

      const variable = existingVariable
        ? await EnvironmentVariableMutation.updateAsync(graphqlClient, {
            id: existingVariable.id,
            name,
            value,
            visibility,
            environments,
            type,
          })
        : await EnvironmentVariableMutation.createSharedVariableAsync(
            graphqlClient,
            {
              name,
              value,
              visibility,
              environments,
              type: type ?? EnvironmentSecretType.String,
            },
            ownerAccount.id
          );

      if (!variable) {
        throw new Error(`Could not set variable with name ${name} on account ${ownerAccount.name}`);
      }

      Log.withTick(
        `${existingVariable ? 'Updated' : 'Created'} variable ${chalk.bold(name)} on account ${chalk.bold(
          ownerAccount.name
        )}.`
      );
    }
  }

  private async promptForMissingFlagsAsync(
    {
      name,
      value,
      environment: environments,
      visibility,
      'non-interactive': nonInteractive,
      type,
      ...rest
    }: SetFlags,
    { environment }: { environment?: string },
    { graphqlClient, projectId }: { graphqlClient: ExpoGraphqlClient; projectId: string }
  ): Promise<
    Required<
      Omit<SetFlags, 'type' | 'visibility'> & {
        type: EnvironmentSecretType | undefined;
        visibility: EnvironmentVariableVisibility;
      }
    > & { fileName?: string }
  > {
    if (!name) {
      name = await promptVariableNameAsync(nonInteractive);
    }

    let newType;
    let newVisibility = visibility ? parseVisibility(visibility) : undefined;

    if (type === 'file') {
      newType = EnvironmentSecretType.FileBase64;
    } else if (type === 'string') {
      newType = EnvironmentSecretType.String;
    }

    if (!type && !value && !nonInteractive) {
      newType = await promptVariableTypeAsync(nonInteractive);
    }

    if (!newVisibility) {
      newVisibility = await promptVariableVisibilityAsync(nonInteractive);
    }

    if (!value) {
      value = await promptVariableValueAsync({
        nonInteractive,
        hidden: newVisibility !== EnvironmentVariableVisibility.Public,
        filePath: newType === EnvironmentSecretType.FileBase64,
      });
    }

    let environmentFilePath: string | undefined;
    let fileName: string | undefined;

    if (newType === EnvironmentSecretType.FileBase64) {
      environmentFilePath = path.resolve(value);
      if (!(await fs.pathExists(environmentFilePath))) {
        throw new Error(`File "${value}" does not exist`);
      }
      fileName = path.basename(environmentFilePath);
    }

    value = environmentFilePath ? await fs.readFile(environmentFilePath, 'base64') : value;

    let newEnvironments = environments ?? (environment ? [environment] : undefined);

    if (!newEnvironments) {
      newEnvironments = await promptVariableEnvironmentAsync({
        nonInteractive,
        multiple: true,
        canEnterCustomEnvironment: true,
        graphqlClient,
        projectId,
      });

      if (!newEnvironments || newEnvironments.length === 0) {
        throw new Error('No environments selected');
      }
    }

    newVisibility = newVisibility ?? EnvironmentVariableVisibility.Public;

    return {
      name,
      value,
      environment: newEnvironments,
      visibility: newVisibility,
      'non-interactive': nonInteractive,
      type: newType,
      fileName,
      ...rest,
    };
  }

  private sanitizeFlags(flags: RawSetFlags): SetFlags {
    return {
      ...flags,
      scope:
        flags.scope === 'account'
          ? EnvironmentVariableScope.Shared
          : EnvironmentVariableScope.Project,
    };
  }
}
