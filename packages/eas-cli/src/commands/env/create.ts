import { Flags } from '@oclif/core';
import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';

import EasCommand from '../../commandUtils/EasCommand';
import {
  EASEnvironmentVariableScopeFlag,
  EASEnvironmentVariableScopeFlagValue,
  EASMultiEnvironmentFlag,
  EASNonInteractiveFlag,
  EASVariableVisibilityFlag,
} from '../../commandUtils/flags';
import {
  EnvironmentSecretType,
  EnvironmentVariableEnvironment,
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
import { isEnvironment, performForEnvironmentsAsync } from '../../utils/variableUtils';

interface RawCreateFlags {
  name?: string;
  value?: string;
  link?: boolean;
  force?: boolean;
  type?: 'string' | 'file';
  visibility?: 'plaintext' | 'sensitive' | 'secret';
  scope: EASEnvironmentVariableScopeFlagValue;
  environment?: EnvironmentVariableEnvironment[];
  'non-interactive': boolean;
}

interface CreateFlags {
  name?: string;
  value?: string;
  link?: boolean;
  force?: boolean;
  type?: 'string' | 'file';
  visibility?: 'plaintext' | 'sensitive' | 'secret';
  scope: EnvironmentVariableScope;
  environment?: EnvironmentVariableEnvironment[];
  'non-interactive': boolean;
}

export default class EnvCreate extends EasCommand {
  static override description = 'create an environment variable for the current project or account';

  static override args = [
    {
      name: 'environment',
      description:
        "Environment to create the variable in. One of 'production', 'preview', or 'development'.",
      required: false,
    },
  ];

  static override flags = {
    name: Flags.string({
      description: 'Name of the variable',
    }),
    value: Flags.string({
      description: 'Text value or the variable',
    }),
    link: Flags.boolean({
      description: 'Link account-wide variable to the current project',
      hidden: true, // every account-wide variable is global for now so it's not user facing
    }),
    force: Flags.boolean({
      description: 'Overwrite existing variable',
      default: false,
    }),
    type: Flags.enum<'string' | 'file'>({
      description: 'The type of variable',
      options: ['string', 'file'],
    }),
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
    const { args, flags } = await this.parse(EnvCreate);

    const validatedFlags = this.sanitizeFlags(flags);

    const {
      name,
      value,
      scope,
      'non-interactive': nonInteractive,
      environment: environments,
      visibility,
      link,
      force,
      type,
      fileName,
    } = await this.promptForMissingFlagsAsync(validatedFlags, args);

    const {
      projectId,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(EnvCreate, {
      nonInteractive,
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
        if (existingVariable.scope === EnvironmentVariableScope.Shared) {
          await this.promptForOverwriteAsync({
            nonInteractive,
            force,
            message: `Account-wide variable with ${name} name already exists on this account.`,
            suggestion: 'Do you want to unlink it first?',
          });

          Log.withTick(
            `Unlinking account-wide variable ${chalk.bold(name)} on project ${chalk.bold(
              projectDisplayName
            )}.`
          );

          await performForEnvironmentsAsync(environments, async environment => {
            await EnvironmentVariableMutation.unlinkSharedEnvironmentVariableAsync(
              graphqlClient,
              existingVariable.id,
              projectId,
              environment
            );
          });
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
                isGlobal: true, // TODO: every account-wide variable is global for now so it's not user facing
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

      if (link) {
        Log.withTick(
          `Linking account-wide variable ${chalk.bold(name)} to project ${chalk.bold(
            projectDisplayName
          )}.`
        );

        await performForEnvironmentsAsync(environments, async environment => {
          await EnvironmentVariableMutation.linkSharedEnvironmentVariableAsync(
            graphqlClient,
            variable.id,
            projectId,
            environment
          );
        });

        Log.withTick(
          `Linked account-wide variable ${chalk.bold(name)} to project ${chalk.bold(
            projectDisplayName
          )}.`
        );
      }
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
    { environment }: { environment?: string }
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

    if (environment && !isEnvironment(environment.toUpperCase())) {
      throw new Error("Invalid environment. Use one of 'production', 'preview', or 'development'.");
    }

    let newEnvironments = environments
      ? environments
      : environment
        ? [environment.toUpperCase() as EnvironmentVariableEnvironment]
        : undefined;

    if (!newEnvironments) {
      newEnvironments = await promptVariableEnvironmentAsync({ nonInteractive, multiple: true });

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
      link: rest.link ?? false,
      force: rest.force ?? false,
      'non-interactive': nonInteractive,
      type: newType,
      fileName,
      ...rest,
    };
  }

  private sanitizeFlags(flags: RawCreateFlags): CreateFlags {
    if (flags.scope !== 'account' && flags.link) {
      throw new Error(
        `Unexpected argument: --link can only be used when creating account-wide variables`
      );
    }

    return {
      ...flags,
      scope:
        flags.scope === 'account'
          ? EnvironmentVariableScope.Shared
          : EnvironmentVariableScope.Project,
    };
  }
}
