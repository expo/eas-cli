import { Flags } from '@oclif/core';
import chalk from 'chalk';

import EasCommand from '../../commandUtils/EasCommand';
import {
  EASEnvironmentFlag,
  EASNonInteractiveFlag,
  EASVariableScopeFlag,
  EASVariableVisibilityFlags,
} from '../../commandUtils/flags';
import { EnvironmentVariableScope, EnvironmentVariableVisibility } from '../../graphql/generated';
import { EnvironmentVariableMutation } from '../../graphql/mutations/EnvironmentVariableMutation';
import { EnvironmentVariablesQuery } from '../../graphql/queries/EnvironmentVariablesQuery';
import Log from '../../log';
import {
  getDisplayNameForProjectIdAsync,
  getOwnerAccountForProjectIdAsync,
} from '../../project/projectUtils';
import { confirmAsync } from '../../prompts';
import {
  promptVariableEnvironmentAsync,
  promptVariableNameAsync,
  promptVariableValueAsync,
} from '../../utils/prompts';

export default class EnvironmentVariableCreate extends EasCommand {
  static override description =
    'create an environment variable on the current project or owner account';

  static override hidden = true;

  static override flags = {
    name: Flags.string({
      description: 'Name of the variable',
    }),
    value: Flags.string({
      description: 'Text value or the variable',
    }),
    link: Flags.boolean({
      description: 'Link shared variable to the current project',
    }),
    force: Flags.boolean({
      description: 'Overwrite existing variable',
      default: false,
    }),
    ...EASVariableVisibilityFlags,
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
    let {
      flags: {
        name,
        value,
        scope,
        'non-interactive': nonInteractive,
        environment,
        sensitive,
        secret,
        link,
        force,
      },
    } = await this.parse(EnvironmentVariableCreate);
    const {
      privateProjectConfig: { projectId },
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(EnvironmentVariableCreate, {
      nonInteractive,
    });

    const [projectDisplayName, ownerAccount] = await Promise.all([
      getDisplayNameForProjectIdAsync(graphqlClient, projectId),
      getOwnerAccountForProjectIdAsync(graphqlClient, projectId),
    ]);

    if (!name) {
      name = await promptVariableNameAsync(nonInteractive);
    }

    let overwrite = false;

    let visibility = EnvironmentVariableVisibility.Public;
    if (sensitive) {
      visibility = EnvironmentVariableVisibility.Sensitive;
    } else if (secret) {
      visibility = EnvironmentVariableVisibility.Secret;
    }

    if (!value) {
      value = await promptVariableValueAsync({
        nonInteractive,
        hidden: visibility !== EnvironmentVariableVisibility.Public,
      });
    }

    if (scope === EnvironmentVariableScope.Project) {
      if (link) {
        throw new Error(`Unexpected argument: --link can only be used with shared variables`);
      }
      if (!environment) {
        environment = await promptVariableEnvironmentAsync(nonInteractive);
      }
      const { appVariables: existingVariables } = await EnvironmentVariablesQuery.byAppIdAsync(
        graphqlClient,
        projectId,
        environment
      );
      const existingVariable = existingVariables.find(variable => variable.name === name);

      if (existingVariable) {
        if (existingVariable.scope === EnvironmentVariableScope.Shared) {
          if (!nonInteractive) {
            const confirmation = await confirmAsync({
              message: `Shared variable ${name} already exists on this project. Do you want to unlink it first?`,
            });

            if (!confirmation) {
              Log.log('Aborting');
              return;
            }
          } else if (!force) {
            throw new Error(
              `Shared variable ${name} already exists on this project. Use --force to overwrite it.`
            );
          }

          await EnvironmentVariableMutation.unlinkSharedEnvironmentVariableAsync(
            graphqlClient,
            existingVariable.id,
            projectId,
            environment
          );
          Log.withTick(
            `Unlinking shared variable ${chalk.bold(name)} on project ${chalk.bold(
              projectDisplayName
            )}.`
          );
        } else {
          if (!nonInteractive) {
            const confirmation = await confirmAsync({
              message: `Variable ${name} already exists on this project. Do you want to overwrite it?`,
            });

            if (!confirmation) {
              Log.log('Aborting');
              return;
            }
          } else if (!force) {
            throw new Error(
              `Shared variable ${name} already exists on this project. Use --force to overwrite it.`
            );
          }
          overwrite = true;
        }
      }

      const variable = await EnvironmentVariableMutation.createForAppAsync(
        graphqlClient,
        {
          name,
          value,
          environment,
          visibility,
          overwrite,
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
      const sharedVariables = await EnvironmentVariablesQuery.sharedAsync(graphqlClient, projectId);
      const existingVariable = sharedVariables.find(variable => variable.name === name);
      if (existingVariable) {
        throw new Error(
          `Shared variable with ${name} name already exists on this account. Use a different name or delete the existing variable.`
        );
      }

      if (environment && !link) {
        if (!nonInteractive) {
          const confirmation = await confirmAsync({
            message: `Unexpected argument: --environment can only be used with --link flag. Do you want to link the variable to the current project?`,
          });

          if (!confirmation) {
            Log.log('Aborting');
            return;
          }
        } else {
          throw new Error('Unexpected argument: --environment can only be used with --link flag.');
        }
      }

      if (!environment && link) {
        environment = await promptVariableEnvironmentAsync(nonInteractive);
      }

      const variable = await EnvironmentVariableMutation.createSharedVariableAsync(
        graphqlClient,
        {
          name,
          value,
          visibility,
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

      if (link && environment) {
        Log.withTick(
          `Linking shared variable ${chalk.bold(name)} to project ${chalk.bold(
            projectDisplayName
          )}.`
        );
        await EnvironmentVariableMutation.linkSharedEnvironmentVariableAsync(
          graphqlClient,
          variable.id,
          projectId,
          environment
        );
        Log.withTick(
          `Linked shared variable ${chalk.bold(name)} to project ${chalk.bold(projectDisplayName)}.`
        );
      }
    }
  }
}
