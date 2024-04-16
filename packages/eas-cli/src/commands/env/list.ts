import chalk from 'chalk';
import dateFormat from 'dateformat';

import EasCommand from '../../commandUtils/EasCommand';
import {
  EASEnvironmentFlag,
  EASVariableFormatFlag,
  EASVariableScopeFlag,
  EASVariableSensitiveFlag,
} from '../../commandUtils/flags';
import { EnvironmentVariableFragment, EnvironmentVariableScope } from '../../graphql/generated';
import { EnvironmentVariablesQuery } from '../../graphql/queries/EnvironmentVariablesQuery';
import Log from '../../log';
import formatFields from '../../utils/formatFields';
import { promptVariableEnvironmentAsync } from '../../utils/prompts';

export default class EnvironmentValueList extends EasCommand {
  static override description = 'list environment variables for the current project';

  static override contextDefinition = {
    ...this.ContextOptions.ProjectConfig,
    ...this.ContextOptions.LoggedIn,
  };

  static override flags = {
    ...EASVariableFormatFlag,
    ...EASVariableSensitiveFlag,
    ...EASVariableScopeFlag,
    ...EASEnvironmentFlag,
  };

  async runAsync(): Promise<void> {
    let {
      flags: { environment, format, scope },
    } = await this.parse(EnvironmentValueList);
    const {
      privateProjectConfig: { projectId },
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(EnvironmentValueList, {
      nonInteractive: true,
    });

    let variables;

    if (scope === EnvironmentVariableScope.Shared) {
      variables = await EnvironmentVariablesQuery.sharedAsync(graphqlClient, projectId);
    } else {
      if (!environment) {
        environment = await promptVariableEnvironmentAsync(false);
      }
      variables = (
        await EnvironmentVariablesQuery.byAppIdAsync(graphqlClient, projectId, environment)
      ).appVariables;
    }

    if (format === 'short') {
      for (const variable of variables) {
        Log.log(chalk`{bold ${variable.name}}=${variable.value || '*****'}`);
      }
    } else {
      if (scope === EnvironmentVariableScope.Shared) {
        Log.log(chalk`{bold Shared variables for this account:}`);
      } else {
        Log.log(chalk`{bold Variables for this project for environment ${environment}:}`);
      }
      Log.log(
        variables.map(variable => formatVariable(variable)).join(`\n\n${chalk.dim('———')}\n\n`)
      );
    }
  }
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
