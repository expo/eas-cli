import chalk from 'chalk';

import EasCommand from '../../commandUtils/EasCommand';
import {
  EASEnvironmentFlag,
  EASVariableFormatFlag,
  EASVariableScopeFlag,
} from '../../commandUtils/flags';
import { EnvironmentVariableScope } from '../../graphql/generated';
import { EnvironmentVariablesQuery } from '../../graphql/queries/EnvironmentVariablesQuery';
import Log from '../../log';
import { formatVariable } from '../../utils/formatVariable';
import { promptVariableEnvironmentAsync } from '../../utils/prompts';

export default class EnvironmentValueList extends EasCommand {
  static override description = 'list environment variables for the current project';

  static override hidden = true;

  static override contextDefinition = {
    ...this.ContextOptions.ProjectConfig,
    ...this.ContextOptions.LoggedIn,
  };

  static override flags = {
    ...EASVariableFormatFlag,
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

    if (scope === EnvironmentVariableScope.Project && !environment) {
      environment = await promptVariableEnvironmentAsync(false);
    }

    const variables =
      scope === EnvironmentVariableScope.Project && environment
        ? await EnvironmentVariablesQuery.byAppIdAsync(graphqlClient, {
            appId: projectId,
            environment,
          })
        : await EnvironmentVariablesQuery.sharedAsync(graphqlClient, { appId: projectId });

    if (format === 'short') {
      for (const variable of variables) {
        // TODO: Add Learn more link
        Log.log(
          `${chalk.bold(variable.name)}=${
            variable.value ??
            "***** (This is a secret env variable that can only be accessed on EAS builder and can't be read in any UI. Learn more.)"
          }`
        );
      }
    } else {
      if (scope === EnvironmentVariableScope.Shared) {
        Log.log(chalk.bold('Shared variables for this account:'));
      } else {
        Log.log(chalk.bold(`Variables for this project for environment ${environment}:`));
      }
      Log.log(
        variables.map(variable => formatVariable(variable)).join(`\n\n${chalk.dim('———')}\n\n`)
      );
    }
  }
}
