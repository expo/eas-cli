import { Flags } from '@oclif/core';
import chalk from 'chalk';
import dateFormat from 'dateformat';

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
import formatFields from '../../utils/formatFields';
import { promptVariableEnvironmentAsync, promptVariableNameAsync } from '../../utils/prompts';

export default class EnvironmentValueList extends EasCommand {
  static override description = 'list environment Variables available for your current app';

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
    } = await this.parse(EnvironmentValueList);
    const {
      privateProjectConfig: { projectId },
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(EnvironmentValueList, {
      nonInteractive,
    });

    if (!name) {
      name = await promptVariableNameAsync(nonInteractive);
    }

    if (!environment && scope === EnvironmentVariableScope.Project) {
      environment = await promptVariableEnvironmentAsync(nonInteractive);
    }

    const variable = await getVariableAsync(graphqlClient, scope, projectId, name, environment);

    if (!variable) {
      Log.error(`Variable with name "${name}" not found`);
      return;
    }
    if (variable.value === null) {
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

function formatVariable(variable: EnvironmentVariableFragment): string {
  return formatFields([
    { label: 'ID', value: variable.id },
    { label: 'Name', value: variable.name },
    { label: 'Value', value: variable.value || '*****' },
    { label: 'Scope', value: variable.scope },
    { label: 'Created at', value: dateFormat(variable.createdAt, 'mmm dd HH:MM:ss') },
  ]);
}
