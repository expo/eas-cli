import { Flags } from '@oclif/core';
import chalk from 'chalk';

import { withSudoModeAsync } from '../../authUtils';
import EasCommand from '../../commandUtils/EasCommand';
import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import {
  EASEnvironmentFlag,
  EASVariableFormatFlag,
  EASVariableScopeFlag,
} from '../../commandUtils/flags';
import {
  EnvironmentVariableEnvironment,
  EnvironmentVariableFragment,
  EnvironmentVariableScope,
} from '../../graphql/generated';
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
    ...this.ContextOptions.SessionManagment,
  };

  static override flags = {
    'include-sensitive': Flags.boolean({
      description: 'Display sensitive values in the output',
      default: false,
    }),
    ...EASVariableFormatFlag,
    ...EASVariableScopeFlag,
    ...EASEnvironmentFlag,
  };

  async runAsync(): Promise<void> {
    let {
      flags: { environment, format, scope, 'include-sensitive': includeSensitive },
    } = await this.parse(EnvironmentValueList);
    const {
      privateProjectConfig: { projectId },
      loggedIn: { graphqlClient },
      sessionManager,
    } = await this.getContextAsync(EnvironmentValueList, {
      nonInteractive: true,
    });

    if (scope === EnvironmentVariableScope.Project && !environment) {
      environment = await promptVariableEnvironmentAsync(false);
    }

    const variables = await this.getVariablesForScopeAsync(graphqlClient, {
      scope,
      includingSensitive: includeSensitive,
      environment,
      projectId,
    });

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

  private async getVariablesForScopeAsync(
    graphqlClient: ExpoGraphqlClient,
    {
      scope,
      includingSensitive,
      environment,
      projectId,
    }: {
      scope: EnvironmentVariableScope;
      includingSensitive: boolean;
      environment?: EnvironmentVariableEnvironment;
      projectId: string;
    }
  ): Promise<EnvironmentVariableFragment[]> {
    if (scope === EnvironmentVariableScope.Project && environment) {
      if (includingSensitive) {
        return await EnvironmentVariablesQuery.byAppIdWithSensitiveAsync(graphqlClient, {
          appId: projectId,
          environment,
        });
      }
      return await EnvironmentVariablesQuery.byAppIdAsync(graphqlClient, {
        appId: projectId,
        environment,
      });
    }

    return includingSensitive
      ? await EnvironmentVariablesQuery.sharedWithSensitiveAsync(graphqlClient, {
          appId: projectId,
        })
      : await EnvironmentVariablesQuery.sharedAsync(graphqlClient, { appId: projectId });
  }
}
