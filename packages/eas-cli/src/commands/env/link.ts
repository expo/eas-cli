import { Flags } from '@oclif/core';
import chalk from 'chalk';

import EasCommand from '../../commandUtils/EasCommand';
import { EASEnvironmentFlag, EASNonInteractiveFlag } from '../../commandUtils/flags';
import { EnvironmentVariableMutation } from '../../graphql/mutations/EnvironmentVariableMutation';
import { EnvironmentVariablesQuery } from '../../graphql/queries/EnvironmentVariablesQuery';
import Log from '../../log';
import { getDisplayNameForProjectIdAsync } from '../../project/projectUtils';
import { selectAsync } from '../../prompts';
import { promptVariableEnvironmentAsync } from '../../utils/prompts';

export default class EnvironmentVariableLink extends EasCommand {
  static override description = 'link a shared environment variable to the current project';

  static override hidden = true;

  static override flags = {
    name: Flags.string({
      description: 'Name of the variable',
    }),
    ...EASEnvironmentFlag,
    ...EASNonInteractiveFlag,
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectConfig,
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    let {
      flags: { name, 'non-interactive': nonInteractive, environment },
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
    });

    if (!name) {
      name = await selectAsync(
        'Select shared variable',
        variables.map(variable => ({
          title: variable.name,
          value: variable.name,
        }))
      );
    }

    const selectedVariable = variables.find(variable => variable.name === name);

    if (!selectedVariable) {
      throw new Error(`Shared variable ${name} doesn't exist`);
    }

    if (!environment) {
      environment = await promptVariableEnvironmentAsync({ nonInteractive });
    }

    const linkedVariable = await EnvironmentVariableMutation.linkSharedEnvironmentVariableAsync(
      graphqlClient,
      selectedVariable.id,
      projectId,
      environment
    );
    if (!linkedVariable) {
      throw new Error(
        `Could not link variable with name ${selectedVariable.name} to project with id ${projectId}`
      );
    }

    Log.withTick(
      `Linked variable ${chalk.bold(linkedVariable.name)} to project ${chalk.bold(
        projectDisplayName
      )}.`
    );
  }
}
