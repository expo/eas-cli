import { Flags } from '@oclif/core';
import chalk from 'chalk';

import EasCommand from '../../commandUtils/EasCommand';
import {
  EASMultiEnvironmentFlag,
  EASNonInteractiveFlag,
  EasEnvironmentFlagParameters,
} from '../../commandUtils/flags';
import { EnvironmentVariableEnvironment } from '../../graphql/generated';
import { EnvironmentVariableMutation } from '../../graphql/mutations/EnvironmentVariableMutation';
import { EnvironmentVariablesQuery } from '../../graphql/queries/EnvironmentVariablesQuery';
import Log from '../../log';
import { getDisplayNameForProjectIdAsync } from '../../project/projectUtils';
import { selectAsync } from '../../prompts';
import { promptVariableEnvironmentAsync } from '../../utils/prompts';
import { formatVariableName } from '../../utils/variableUtils';

export default class EnvironmentVariableLink extends EasCommand {
  static override description = 'link a shared environment variable to the current project';

  static override hidden = true;

  static override flags = {
    'variable-name': Flags.string({
      description: 'Name of the variable',
    }),
    'variable-environment': Flags.enum<EnvironmentVariableEnvironment>({
      ...EasEnvironmentFlagParameters,
      description: 'Current environment of the variable to link',
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
        'variable-environment': currentEnvironment,
        'non-interactive': nonInteractive,
        environment: environments,
      },
    } = await this.parse(EnvironmentVariableLink);
    const {
      privateProjectConfig: { projectId },
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(EnvironmentVariableLink, {
      nonInteractive,
    });

    const projectDisplayName = await getDisplayNameForProjectIdAsync(graphqlClient, projectId);
    const variables = await EnvironmentVariablesQuery.sharedAsync(graphqlClient, {
      appId: projectId,
      environment: currentEnvironment,
      filterNames: name ? [name] : undefined,
    });

    let selectedVariable = variables[0];

    if (variables.length > 1) {
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
    if (!nonInteractive && !environments) {
      const selectedEnvironments =
        (selectedVariable.linkedEnvironments ?? []).length > 0
          ? selectedVariable.linkedEnvironments
          : selectedVariable.environments;
      environments = await promptVariableEnvironmentAsync({
        nonInteractive,
        multiple: true,
        selectedEnvironments: selectedEnvironments ?? [],
      });
      explicitSelect = true;
    }

    if (!environments) {
      await EnvironmentVariableMutation.linkSharedEnvironmentVariableAsync(
        graphqlClient,
        selectedVariable.id,
        projectId
      );
      Log.withTick(
        `Linked variable ${chalk.bold(selectedVariable.name)} to project ${chalk.bold(
          projectDisplayName
        )} in ${selectedVariable.environments?.join(', ').toLocaleLowerCase()}.`
      );
      return;
    }

    for (const environment of Object.values(EnvironmentVariableEnvironment)) {
      try {
        if (
          selectedVariable.linkedEnvironments?.includes(environment) ===
          environments.includes(environment)
        ) {
          if (!explicitSelect && environments.includes(environment)) {
            Log.withTick(
              `Variable ${chalk.bold(
                selectedVariable.name
              )} is already linked to ${environment.toLocaleLowerCase()}.`
            );
          }
          continue;
        }
        if (environments.includes(environment)) {
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
        } else if (explicitSelect) {
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
        }
      } catch (err: any) {
        Log.warn(err.message);
      }
    }
  }
}
