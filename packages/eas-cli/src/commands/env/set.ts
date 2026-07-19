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
  EASVariableVisibilityFlag,
  EasNonInteractiveAndJsonFlags,
  resolveNonInteractiveAndJsonFlags,
} from '../../commandUtils/flags';
import {
  EnvironmentSecretType,
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
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';
import {
  parseVisibility,
  promptVariableEnvironmentAsync,
  promptVariableNameAsync,
  promptVariableTypeAsync,
  promptVariableValueAsync,
  promptVariableVisibilityAsync,
} from '../../utils/prompts';

interface RawSetFlags {
  'variable-name'?: string;
  'variable-value'?: string;
  type?: 'string' | 'file';
  visibility?: 'plaintext' | 'sensitive' | 'secret';
  scope: EASEnvironmentVariableScopeFlagValue;
  environment?: string[];
  'non-interactive': boolean;
  json: boolean;
}

interface SetFlags {
  'variable-name'?: string;
  'variable-value'?: string;
  type?: 'string' | 'file';
  visibility?: 'plaintext' | 'sensitive' | 'secret';
  scope: EnvironmentVariableScope;
  environment?: string[];
  'non-interactive': boolean;
  json: boolean;
}

interface ResolvedVariableDetails {
  value: string;
  visibility: EnvironmentVariableVisibility;
  type: EnvironmentSecretType | undefined;
  fileName: string | undefined;
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
    'variable-name': Flags.string({
      description: 'Name of the variable',
      aliases: ['name'],
    }),
    'variable-value': Flags.string({
      description: 'Text value of the variable',
      aliases: ['value'],
    }),
    type: Flags.option({
      description: 'The type of variable',
      options: ['string', 'file'] as const,
    })(),
    ...EASVariableVisibilityFlag,
    ...EASEnvironmentVariableScopeFlag,
    ...EASMultiEnvironmentFlag,
    ...EasNonInteractiveAndJsonFlags,
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectId,
    ...this.ContextOptions.Analytics,
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const { args, flags } = await this.parse(EnvSet);

    const {
      'variable-name': nameFlag,
      'variable-value': value,
      type,
      visibility,
      scope,
      environment,
    } = this.sanitizeFlags(flags);
    const { json: jsonFlag, nonInteractive } = resolveNonInteractiveAndJsonFlags(flags);

    const {
      projectId,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(EnvSet, {
      nonInteractive,
    });

    if (jsonFlag) {
      enableJsonOutput();
    }

    const name = nameFlag ?? (await promptVariableNameAsync(nonInteractive));

    const environments = await this.resolveEnvironmentsAsync(environment, args.environment, {
      nonInteractive,
      graphqlClient,
      projectId,
    });

    const existingVariable = await this.findExistingVariableAsync(graphqlClient, {
      scope,
      projectId,
      name,
      environments,
    });
    const environmentsToSet = existingVariable
      ? [...new Set([...(existingVariable.environments ?? []), ...environments])]
      : environments;

    const {
      value: resolvedValue,
      visibility: resolvedVisibility,
      type: resolvedType,
      fileName,
    } = await this.resolveVariableDetailsAsync(
      { name, value, type, visibility, nonInteractive },
      existingVariable
    );

    const [projectDisplayName, ownerAccount] = await Promise.all([
      getDisplayNameForProjectIdAsync(graphqlClient, projectId),
      getOwnerAccountForProjectIdAsync(graphqlClient, projectId),
    ]);

    if (scope === EnvironmentVariableScope.Project) {
      const variable = existingVariable
        ? await EnvironmentVariableMutation.updateAsync(graphqlClient, {
            id: existingVariable.id,
            name,
            value: resolvedValue,
            visibility: resolvedVisibility,
            environments: environmentsToSet,
            type: resolvedType,
            fileName,
          })
        : await EnvironmentVariableMutation.createForAppAsync(
            graphqlClient,
            {
              name,
              value: resolvedValue,
              environments,
              visibility: resolvedVisibility,
              type: resolvedType ?? EnvironmentSecretType.String,
              fileName,
            },
            projectId
          );

      if (!variable) {
        throw new Error(
          `Could not set variable with name ${name} on project ${projectDisplayName}`
        );
      }

      if (jsonFlag) {
        printJsonOnlyOutput(variable);
      } else {
        Log.withTick(
          `${existingVariable ? 'Updated' : 'Created'} variable ${chalk.bold(name)} on project ${chalk.bold(
            projectDisplayName
          )}.`
        );
      }
    } else if (scope === EnvironmentVariableScope.Shared) {
      const variable = existingVariable
        ? await EnvironmentVariableMutation.updateAsync(graphqlClient, {
            id: existingVariable.id,
            name,
            value: resolvedValue,
            visibility: resolvedVisibility,
            environments: environmentsToSet,
            type: resolvedType,
          })
        : await EnvironmentVariableMutation.createSharedVariableAsync(
            graphqlClient,
            {
              name,
              value: resolvedValue,
              visibility: resolvedVisibility,
              environments,
              type: resolvedType ?? EnvironmentSecretType.String,
            },
            ownerAccount.id
          );

      if (!variable) {
        throw new Error(`Could not set variable with name ${name} on account ${ownerAccount.name}`);
      }

      if (jsonFlag) {
        printJsonOnlyOutput(variable);
      } else {
        Log.withTick(
          `${existingVariable ? 'Updated' : 'Created'} variable ${chalk.bold(name)} on account ${chalk.bold(
            ownerAccount.name
          )}.`
        );
      }
    }
  }

  private async resolveEnvironmentsAsync(
    environmentFlag: string[] | undefined,
    environmentArg: string | undefined,
    {
      nonInteractive,
      graphqlClient,
      projectId,
    }: { nonInteractive: boolean; graphqlClient: ExpoGraphqlClient; projectId: string }
  ): Promise<string[]> {
    const environments = environmentFlag ?? (environmentArg ? [environmentArg] : undefined);
    if (environments && environments.length > 0) {
      return environments;
    }

    const promptedEnvironments = await promptVariableEnvironmentAsync({
      nonInteractive,
      multiple: true,
      canEnterCustomEnvironment: true,
      graphqlClient,
      projectId,
    });

    if (!promptedEnvironments || promptedEnvironments.length === 0) {
      throw new Error('No environments selected');
    }

    return promptedEnvironments;
  }

  private async findExistingVariableAsync(
    graphqlClient: ExpoGraphqlClient,
    {
      scope,
      projectId,
      name,
      environments,
    }: {
      scope: EnvironmentVariableScope;
      projectId: string;
      name: string;
      environments: string[];
    }
  ): Promise<EnvironmentVariableFragment | undefined> {
    if (scope === EnvironmentVariableScope.Project) {
      const existingVariables = await EnvironmentVariablesQuery.byAppIdAsync(graphqlClient, {
        appId: projectId,
        filterNames: [name],
      });

      return existingVariables.find(
        variable =>
          variable.scope === EnvironmentVariableScope.Project &&
          variable.environments?.some(env => environments.includes(env))
      );
    }

    const existingVariables = await EnvironmentVariablesQuery.sharedAsync(graphqlClient, {
      appId: projectId,
      filterNames: [name],
    });

    return existingVariables.find(variable =>
      variable.environments?.some(env => environments.includes(env))
    );
  }

  private async resolveVariableDetailsAsync(
    {
      name,
      value,
      type,
      visibility,
      nonInteractive,
    }: {
      name: string;
      value?: string;
      type?: 'string' | 'file';
      visibility?: 'plaintext' | 'sensitive' | 'secret';
      nonInteractive: boolean;
    },
    existingVariable: EnvironmentVariableFragment | undefined
  ): Promise<ResolvedVariableDetails> {
    let newType: EnvironmentSecretType | undefined;
    if (type === 'file') {
      newType = EnvironmentSecretType.FileBase64;
    } else if (type === 'string') {
      newType = EnvironmentSecretType.String;
    }

    let newVisibility = visibility ? parseVisibility(visibility) : undefined;

    if (!type && !value && !nonInteractive) {
      newType = await promptVariableTypeAsync(nonInteractive, existingVariable?.type);
    }

    if (!newVisibility) {
      newVisibility = await promptVariableVisibilityAsync(
        nonInteractive,
        existingVariable?.visibility
      );
    }

    if (value && !newType) {
      newType = existingVariable?.type;
    }

    if (!value) {
      value = await promptVariableValueAsync({
        nonInteractive,
        hidden: newVisibility !== EnvironmentVariableVisibility.Public,
        filePath: (newType ?? existingVariable?.type) === EnvironmentSecretType.FileBase64,
      });
    }

    newVisibility = newVisibility ?? EnvironmentVariableVisibility.Public;

    let fileName: string | undefined;
    if (newType === EnvironmentSecretType.FileBase64) {
      const environmentFilePath = path.resolve(value);
      if (!(await fs.pathExists(environmentFilePath))) {
        if (type === 'file') {
          throw new Error(`File "${value}" does not exist`);
        }
        throw new Error(
          `Variable "${name}" is a file type, but "${value}" does not exist as a file. If you want to convert it to a string, pass --type string.`
        );
      }
      fileName = path.basename(environmentFilePath);
      value = await fs.readFile(environmentFilePath, 'base64');
    }

    return {
      value,
      visibility: newVisibility,
      type: newType,
      fileName,
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
