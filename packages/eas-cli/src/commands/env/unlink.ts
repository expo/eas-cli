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
import { formatVariableName, isEnvironment } from '../../utils/variableUtils';

type UnlinkFlags = {
  'variable-name'?: string;
  'non-interactive': boolean;
  environment?: EnvironmentVariableEnvironment[];
};

export default class EnvUnlink extends EasCommand {
  static override description =
    'unlink an account-wide environment variable from the current project';

  // for now we only roll out global account-wide env variables so this should stay hidden
  static override hidden = true;

  static override flags = {
    'variable-name': Flags.string({
      description: 'Name of the variable',
    }),
    ...EASMultiEnvironmentFlag,
    ...EASNonInteractiveFlag,
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectId,
    ...this.ContextOptions.LoggedIn,
  };

  static override args = [
    {
      name: 'environment',
      description:
        "Environment to unlink the variable from. One of 'production', 'preview', or 'development'.",
      required: false,
    },
  ];

  async runAsync(): Promise<void> {
    const { args, flags } = await this.parse(EnvUnlink);

    let {
      'variable-name': name,
      'non-interactive': nonInteractive,
      environment: unlinkEnvironments,
    } = this.validateInputs(flags, args);

    const {
      projectId,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(EnvUnlink, {
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

  private validateInputs(
    flags: UnlinkFlags,
    { environment }: { environment?: string }
  ): UnlinkFlags {
    if (flags['non-interactive']) {
      if (!flags['variable-name']) {
        throw new Error(
          'Current name is required in non-interactive mode. Run the command with --variable-name flag.'
        );
      }
    }

    if (environment) {
      environment = environment.toUpperCase();
      if (!isEnvironment(environment)) {
        throw new Error(
          "Invalid environment. Use one of 'production', 'preview', or 'development'."
        );
      }
      return {
        environment: [environment],
        ...flags,
      };
    }

    return flags;
  }
}
