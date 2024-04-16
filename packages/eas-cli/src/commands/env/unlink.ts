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

export default class EnvironmentVariableUnlink extends EasCommand {
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
    } = await this.parse(EnvironmentVariableUnlink);
    const {
      privateProjectConfig: { projectId },
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(EnvironmentVariableUnlink, {
      nonInteractive,
    });

    if (!environment) {
      environment = await promptVariableEnvironmentAsync(nonInteractive);
    }

    const projectDisplayName = await getDisplayNameForProjectIdAsync(graphqlClient, projectId);
    let variable;

    const { appVariables, sharedVariables } = await EnvironmentVariablesQuery.byAppIdAsync(
      graphqlClient,
      projectId,
      environment
    );
    const sharedVariablesIds = sharedVariables.map(v => v.id);
    const linkedVariables = appVariables.filter(({ id }) => sharedVariablesIds.includes(id));
    if (linkedVariables.length === 0) {
      Log.fail('No variables to unlink');
      return;
    }
    if (name) {
      variable = linkedVariables.find(variable => variable.name === name);
      if (!variable) {
        throw new Error(`Shared variable ${name} doesn't exist`);
      }
    } else {
      variable = await selectAsync(
        'Select shared variable',
        linkedVariables.map(variable => ({
          title: variable.name,
          value: variable,
        }))
      );
    }

    const unlinkedVariable = await EnvironmentVariableMutation.unlinkSharedEnvironmentVariableAsync(
      graphqlClient,
      variable.id,
      projectId,
      environment
    );
    if (!variable) {
      throw new Error(
        `Could not unlink variable with name ${unlinkedVariable.name} to project with id ${projectId}`
      );
    }

    Log.withTick(
      `Unlinked variable ${chalk.bold(unlinkedVariable.name)} with value ${chalk.bold(
        unlinkedVariable.value
      )} to project ${chalk.bold(projectDisplayName)}.`
    );
  }
}
