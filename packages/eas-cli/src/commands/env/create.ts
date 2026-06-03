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
  extendFlagDescription,
  validateNonInteractiveRequiredInputs,
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
import { confirmAsync } from '../../prompts';
import {
  parseVisibility,
  promptVariableEnvironmentAsync,
  promptVariableNameAsync,
  promptVariableTypeAsync,
  promptVariableValueAsync,
  promptVariableVisibilityAsync,
} from '../../utils/prompts';

interface RawCreateFlags {
  name?: string;
  value?: string;
  force?: boolean;
  type?: 'string' | 'file';
  visibility?: 'plaintext' | 'sensitive' | 'secret';
  scope: EASEnvironmentVariableScopeFlagValue;
  environment?: string[];
  'non-interactive': boolean;
}

interface CreateFlags {
  name?: string;
  value?: string;
  force?: boolean;
  type?: 'string' | 'file';
  visibility?: 'plaintext' | 'sensitive' | 'secret';
  scope: EnvironmentVariableScope;
  environment?: string[];
  'non-interactive': boolean;
}

export default class EnvCreate extends EasCommand {
  static override description = `create an environment variable for the current project or account

In non-interactive mode, provide --name, --value, --visibility, and --environment.
Use --force in non-interactive mode when overwriting an existing variable.`;

  static override examples = [
    '$ eas env:create --environment production --environment preview --name API_TOKEN --value "$API_TOKEN" --visibility sensitive --non-interactive',
    '$ eas env:create production --scope account --name SHARED_TOKEN --value "$SHARED_TOKEN" --visibility secret --non-interactive',
  ];

  static override args = {
    environment: Args.string({
      description:
        "Environment to create the variable in. Required in non-interactive mode unless --environment is provided. Default environments are 'production', 'preview', and 'development'.",
      required: false,
    }),
  };

  static override flags = {
    name: Flags.string({
      description: 'Name of the variable. Required in non-interactive mode.',
    }),
    value: Flags.string({
      description:
        'Text value for the variable, or a file path when --type=file. Required in non-interactive mode.',
    }),
    force: Flags.boolean({
      description: 'Overwrite existing variable. Required in non-interactive mode to overwrite.',
      default: false,
    }),
    type: Flags.option({
      description: 'The type of variable',
      options: ['string', 'file'] as const,
    })(),
    visibility: extendFlagDescription(
      EASVariableVisibilityFlag.visibility,
      'Required in non-interactive mode.'
    ),
    ...EASEnvironmentVariableScopeFlag,
    environment: extendFlagDescription(
      EASMultiEnvironmentFlag.environment,
      'Required in non-interactive mode unless ENVIRONMENT is provided.'
    ),
    'non-interactive': extendFlagDescription(
      EASNonInteractiveFlag['non-interactive'],
      'Requires --name, --value, --visibility, and an environment via ENVIRONMENT or --environment.'
    ),
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectId,
    ...this.ContextOptions.Analytics,
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const { args, flags } = await this.parse(EnvCreate);

    const validatedFlags = this.sanitizeFlags(flags);
    validateNonInteractiveRequiredInputs({
      nonInteractive: validatedFlags['non-interactive'],
      requiredInputs: [
        { name: '--name', value: validatedFlags.name },
        { name: '--value', value: validatedFlags.value },
        { name: '--visibility', value: validatedFlags.visibility },
        {
          name: 'ENVIRONMENT or --environment',
          value: args.environment ?? validatedFlags.environment,
        },
      ],
      helpCommand: 'eas env:create --help',
    });

    const {
      projectId,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(EnvCreate, {
      nonInteractive: validatedFlags['non-interactive'],
    });

    const {
      name,
      value,
      scope,
      'non-interactive': nonInteractive,
      environment: environments,
      visibility,
      force,
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

    let overwrite = false;

    if (scope === EnvironmentVariableScope.Project) {
      const existingVariables = await EnvironmentVariablesQuery.byAppIdAsync(graphqlClient, {
        appId: projectId,
        filterNames: [name],
      });

      const existingVariable = existingVariables.find(
        variable => !environments || variable.environments?.some(env => environments?.includes(env))
      );

      if (existingVariable) {
        if (existingVariable.scope === EnvironmentVariableScope.Project) {
          await this.promptForOverwriteAsync({
            nonInteractive,
            force,
            message: `Variable ${name} already exists on this project.`,
            suggestion: 'Do you want to overwrite it?',
          });
          overwrite = true;
        }
      }

      const variable =
        overwrite && existingVariable
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
          `Could not create variable with name ${name} on project ${projectDisplayName}`
        );
      }

      Log.withTick(
        `Created a new variable ${chalk.bold(name)} on project ${chalk.bold(projectDisplayName)}.`
      );
    } else if (scope === EnvironmentVariableScope.Shared) {
      const existingVariables = await EnvironmentVariablesQuery.sharedAsync(graphqlClient, {
        appId: projectId,
        filterNames: [name],
      });

      const existingVariable = existingVariables.find(
        variable => !environments || variable.environments?.some(env => environments?.includes(env))
      );

      if (existingVariable) {
        if (force) {
          overwrite = true;
        } else {
          throw new Error(
            `Account-wide variable with ${name} name already exists on this account.\n` +
              `Use a different name or delete the existing variable on website or by using the "eas env:delete --name ${name} --scope account" command.`
          );
        }
      }

      const variable =
        overwrite && existingVariable
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
        throw new Error(
          `Could not create variable with name ${name} on account ${ownerAccount.name}`
        );
      }

      Log.withTick(
        `Created a new variable ${chalk.bold(name)} on account ${chalk.bold(ownerAccount.name)}.`
      );
    }
  }

  private async promptForOverwriteAsync({
    nonInteractive,
    force,
    message,
    suggestion,
  }: {
    nonInteractive: boolean;
    force: boolean;
    message: string;
    suggestion: string;
  }): Promise<void> {
    if (!nonInteractive) {
      const confirmation = await confirmAsync({
        message: `${message} ${suggestion}`,
      });

      if (!confirmation) {
        Log.log('Aborting');
        throw new Error(`${message}`);
      }
    } else if (!force) {
      throw new Error(`${message} Use --force to overwrite it.`);
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
    }: CreateFlags,
    { environment }: { environment?: string },
    { graphqlClient, projectId }: { graphqlClient: ExpoGraphqlClient; projectId: string }
  ): Promise<
    Required<
      Omit<CreateFlags, 'type' | 'visibility'> & {
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
      force: rest.force ?? false,
      'non-interactive': nonInteractive,
      type: newType,
      fileName,
      ...rest,
    };
  }

  private sanitizeFlags(flags: RawCreateFlags): CreateFlags {
    return {
      ...flags,
      scope:
        flags.scope === 'account'
          ? EnvironmentVariableScope.Shared
          : EnvironmentVariableScope.Project,
    };
  }
}
