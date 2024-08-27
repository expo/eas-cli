import { Flags } from '@oclif/core';
import chalk from 'chalk';

import EasCommand from '../../commandUtils/EasCommand';
import { EASEnvironmentFlag, EASNonInteractiveFlag } from '../../commandUtils/flags';
import { EnvironmentVariableScope } from '../../graphql/generated';
import { EnvironmentVariableMutation } from '../../graphql/mutations/EnvironmentVariableMutation';
import { EnvironmentVariablesQuery } from '../../graphql/queries/EnvironmentVariablesQuery';
import Log from '../../log';
import { getDisplayNameForProjectIdAsync } from '../../project/projectUtils';
import { selectAsync } from '../../prompts';
import { promptVariableEnvironmentAsync } from '../../utils/prompts';

export default class EnvironmentVariableUnlink extends EasCommand {
  static override description = 'unlink a shared environment variable to the current project';

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

    const appVariables = await EnvironmentVariablesQuery.byAppIdAsync(
      graphqlClient,
      projectId,
      environment
    );
    const linkedVariables = appVariables.filter(
      ({ scope }) => scope === EnvironmentVariableScope.Shared
    );

    if (linkedVariables.length === 0) {
      throw new Error(`There are no linked shared env variables for project ${projectDisplayName}`);
    }

    if (!name) {
      name = await selectAsync(
        'Select shared variable to unlink',
        linkedVariables.map(variable => ({
          title: variable.name,
          value: variable.name,
        }))
      );
    }

    const selectedVariable = linkedVariables.find(variable => variable.name === name);

    if (!selectedVariable) {
      throw new Error(`Shared variable ${name} doesn't exist`);
    }

    const unlinkedVariable = await EnvironmentVariableMutation.unlinkSharedEnvironmentVariableAsync(
      graphqlClient,
      selectedVariable.id,
      projectId,
      environment
    );

    if (!unlinkedVariable) {
      throw new Error(
        `Could not unlink variable with name ${selectedVariable.name} from project ${projectDisplayName}`
      );
    }

    Log.withTick(
      `Unlinked variable ${chalk.bold(unlinkedVariable.name)} from the project ${chalk.bold(
        projectDisplayName
      )}.`
    );
  }
}
