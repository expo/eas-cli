import { Flags } from '@oclif/core';
import chalk from 'chalk';

import EasCommand from '../../commandUtils/EasCommand';
import { EASMultiEnvironmentFlag, EASNonInteractiveFlag } from '../../commandUtils/flags';
import { EnvironmentVariableEnvironment } from '../../graphql/generated';
import { EnvironmentVariableMutation } from '../../graphql/mutations/EnvironmentVariableMutation';
import { EnvironmentVariablesQuery } from '../../graphql/queries/EnvironmentVariablesQuery';
import Log from '../../log';
import { getDisplayNameForProjectIdAsync } from '../../project/projectUtils';
import { selectAsync } from '../../prompts';
import { promptVariableEnvironmentAsync } from '../../utils/prompts';
import { formatVariableName } from '../../utils/variableUtils';

export default class EnvironmentVariableUnlink extends EasCommand {
  static override description = 'unlink a shared environment variable to the current project';

  static override hidden = true;

  static override flags = {
    'variable-name': Flags.string({
      description: 'Name of the variable',
    }),
    ...EASMultiEnvironmentFlag,
    ...EASNonInteractiveFlag,
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectConfig,
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    let {
      flags: {
        'variable-name': name,
        'non-interactive': nonInteractive,
        environment: unlinkEnvironments,
      },
    } = await this.parse(EnvironmentVariableUnlink);
    const {
      privateProjectConfig: { projectId },
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(EnvironmentVariableUnlink, {
      nonInteractive,
    });

    const projectDisplayName = await getDisplayNameForProjectIdAsync(graphqlClient, projectId);
    const variables = await EnvironmentVariablesQuery.sharedAsync(graphqlClient, {
      appId: projectId,
      filterNames: name ? [name] : undefined,
    });

    let selectedVariable = variables[0];

    if (variables.length > 1) {
      if (nonInteractive) {
        throw new Error("Multiple variables found, please select one using '--variable-name'");
      }
      selectedVariable = await selectAsync(
        'Select shared variable',
        variables.map(variable => ({
          title: formatVariableName(variable),
          value: variable,
        }))
      );
    }

    if (!selectedVariable) {
      throw new Error(`Shared variable ${name} doesn't exist`);
    }

    let explicitSelect = false;

    if (!nonInteractive && !unlinkEnvironments) {
      const selectedEnvironments =
        (selectedVariable.linkedEnvironments ?? []).length > 0
          ? selectedVariable.linkedEnvironments
          : selectedVariable.environments;
      const environments = await promptVariableEnvironmentAsync({
        nonInteractive,
        multiple: true,
        selectedEnvironments: selectedEnvironments ?? [],
      });
      explicitSelect = true;
      unlinkEnvironments = Object.values(EnvironmentVariableEnvironment).filter(
        env => !environments.includes(env)
      );
    }

    if (!unlinkEnvironments) {
      await EnvironmentVariableMutation.unlinkSharedEnvironmentVariableAsync(
        graphqlClient,
        selectedVariable.id,
        projectId
      );
      Log.withTick(
        `Unlinked variable ${chalk.bold(selectedVariable.name)} from project ${chalk.bold(
          projectDisplayName
        )} in ${selectedVariable.environments?.join(', ').toLocaleLowerCase()}.`
      );
      return;
    }

    for (const environment of Object.values(EnvironmentVariableEnvironment)) {
      if (
        selectedVariable.linkedEnvironments?.includes(environment) !==
        unlinkEnvironments.includes(environment)
      ) {
        if (!explicitSelect && unlinkEnvironments.includes(environment)) {
          Log.withTick(
            `Variable ${chalk.bold(
              selectedVariable.name
            )} is already unlinked from ${environment.toLocaleLowerCase()}.`
          );
        }
        continue;
      }
      if (unlinkEnvironments.includes(environment)) {
        await EnvironmentVariableMutation.unlinkSharedEnvironmentVariableAsync(
          graphqlClient,
          selectedVariable.id,
          projectId,
          environment
        );
        Log.withTick(
          `Unlinked variable ${chalk.bold(selectedVariable.name)} from project ${chalk.bold(
            projectDisplayName
          )} in ${environment.toLocaleLowerCase()}.`
        );
      } else if (explicitSelect) {
        await EnvironmentVariableMutation.linkSharedEnvironmentVariableAsync(
          graphqlClient,
          selectedVariable.id,
          projectId,
          environment
        );
        Log.withTick(
          `Linked variable ${chalk.bold(selectedVariable.name)} to project ${chalk.bold(
            projectDisplayName
          )} in ${environment.toLocaleLowerCase()}.`
        );
      }
    }
  }
}
