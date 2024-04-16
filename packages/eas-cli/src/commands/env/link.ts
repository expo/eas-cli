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
    let variable;

    const variables = await EnvironmentVariablesQuery.sharedAsync(graphqlClient, projectId);
    if (name) {
      variable = variables.find(variable => variable.name === name);
      if (!variable) {
        throw new Error(`Shared variable ${name} doesn't exist`);
      }
    } else {
      variable = await selectAsync(
        'Select shared variable',
        variables.map(variable => ({
          title: variable.name,
          value: variable,
        }))
      );
    }

    if (!environment) {
      environment = await promptVariableEnvironmentAsync(nonInteractive);
    }

    const linkedVariable = await EnvironmentVariableMutation.linkSharedEnvironmentVariableAsync(
      graphqlClient,
      variable.id,
      projectId,
      environment
    );
    if (!variable) {
      throw new Error(
        `Could not link variable with name ${linkedVariable.name} to project with id ${projectId}`
      );
    }

    Log.withTick(
      `Linked variable ${chalk.bold(linkedVariable.name)} with value ${chalk.bold(
        linkedVariable.value
      )} to project ${chalk.bold(projectDisplayName)}.`
    );
  }
}
