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
import { formatVariableName, isEnvironment } from '../../utils/variableUtils';

type LinkFlags = {
  'variable-name'?: string;
  'variable-environment'?: EnvironmentVariableEnvironment;
  'non-interactive': boolean;
  environment?: EnvironmentVariableEnvironment[];
};

export default class EnvLink extends EasCommand {
  static override description = 'link an account-wide environment variable to the current project';

  // for now we only roll out global account-wide env variables so this should stay hidden
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

  static override args = [
    {
      name: 'environment',
      description:
        "Environment to pull variables from. One of 'production', 'preview', or 'development'.",
      required: false,
    },
  ];

  static override contextDefinition = {
    ...this.ContextOptions.ProjectId,
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const { args, flags } = await this.parse(EnvLink);

    let {
      'variable-name': name,
      'variable-environment': currentEnvironment,
      'non-interactive': nonInteractive,
      environment: environments,
    } = this.validateInputs(flags, args);

    const {
      projectId,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(EnvLink, {
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
      if (nonInteractive) {
        throw new Error(
          'Multiple variables found, run command with --variable-name and --variable-environment arguments.'
        );
      }
      selectedVariable = await selectAsync(
        'Select account-wide variable',
        variables.map(variable => ({
          title: formatVariableName(variable),
          value: variable,
        }))
      );
    }

    if (!selectedVariable) {
      throw new Error(`Account-wide variable ${name} doesn't exist`);
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
  private validateInputs(flags: LinkFlags, { environment }: { environment?: string }): LinkFlags {
    environment = environment?.toUpperCase();

    if (environment && !isEnvironment(environment)) {
      throw new Error("Invalid environment. Use one of 'production', 'preview', or 'development'.");
    }

    const environments = flags.environment
      ? flags.environment
      : environment
        ? [environment as EnvironmentVariableEnvironment]
        : undefined;

    if (flags['non-interactive']) {
      if (!flags['variable-name']) {
        throw new Error(
          `Environment variable needs 'name' to be specified when running in non-interactive mode. Run the command with ${chalk.bold(
            '--variable-name VARIABLE_NAME'
          )} flag to fix the issue`
        );
      }
    }

    return {
      ...flags,
      environment: environments,
    };
  }
}
