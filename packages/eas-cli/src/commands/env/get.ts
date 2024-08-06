import { Flags } from '@oclif/core';
import chalk from 'chalk';

import EasCommand from '../../commandUtils/EasCommand';
import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import {
  EASEnvironmentFlag,
  EASNonInteractiveFlag,
  EASVariableFormatFlag,
  EASVariableScopeFlag,
} from '../../commandUtils/flags';
import { EnvironmentVariableFragment, EnvironmentVariableScope } from '../../graphql/generated';
import { EnvironmentVariablesQuery } from '../../graphql/queries/EnvironmentVariablesQuery';
import Log from '../../log';
import { formatVariable } from '../../utils/formatVariable';
import { promptVariableEnvironmentAsync, promptVariableNameAsync } from '../../utils/prompts';

export default class EnvironmentValueGet extends EasCommand {
  static override description = 'get environment variable';

  static override hidden = true;

  static override contextDefinition = {
    ...this.ContextOptions.ProjectConfig,
    ...this.ContextOptions.LoggedIn,
  };

  static override flags = {
    name: Flags.string({
      description: 'Name of the variable',
    }),
    ...EASVariableFormatFlag,
    ...EASVariableScopeFlag,
    ...EASNonInteractiveFlag,
    ...EASEnvironmentFlag,
  };

  async runAsync(): Promise<void> {
    let {
      flags: { environment, name, 'non-interactive': nonInteractive, format, scope },
    } = await this.parse(EnvironmentValueGet);
    const {
      privateProjectConfig: { projectId },
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(EnvironmentValueGet, {
      nonInteractive,
    });

    if (!name) {
      name = await promptVariableNameAsync(nonInteractive);
    }

    if (environment && scope === EnvironmentVariableScope.Shared) {
      throw new Error(`Unexpected argument: --environment can only be used with project variables`);
    }

    if (!environment && scope === EnvironmentVariableScope.Project) {
      environment = await promptVariableEnvironmentAsync(nonInteractive);
    }

    const variable = await getVariableAsync(graphqlClient, scope, projectId, name, environment);

    if (!variable) {
      Log.error(`Variable with name "${name}" not found`);
      return;
    }
    if (!variable.value) {
      Log.log(
        chalk`{bold ${variable.name}} is a secret variable and cannot be displayed once it has been created.`
      );
      return;
    }

    if (format === 'short') {
      Log.log(chalk`{bold ${variable.name}}=${variable.value}`);
    } else {
      Log.log(formatVariable(variable));
    }
  }
}

async function getVariableAsync(
  graphqlClient: ExpoGraphqlClient,
  scope: string,
  projectId: string,
  name: string,
  environment: string | undefined
): Promise<EnvironmentVariableFragment | null> {
  if (!environment && scope === EnvironmentVariableScope.Project) {
    throw new Error('Environment is required.');
  }
  if (environment && scope === EnvironmentVariableScope.Project) {
    const { appVariables } = await EnvironmentVariablesQuery.byAppIdAsync(
      graphqlClient,
      projectId,
      environment,
      [name]
    );
    return appVariables[0];
  }

  if (scope === EnvironmentVariableScope.Shared) {
    const sharedVariables = await EnvironmentVariablesQuery.sharedAsync(graphqlClient, projectId, [
      name,
    ]);
    return sharedVariables[0];
  }

  return null;
}
