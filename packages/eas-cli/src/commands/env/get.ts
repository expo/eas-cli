import { Flags } from '@oclif/core';
import chalk from 'chalk';

import { withSudoModeAsync } from '../../authUtils';
import EasCommand from '../../commandUtils/EasCommand';
import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import {
  EASEnvironmentFlag,
  EASNonInteractiveFlag,
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
import { promptVariableEnvironmentAsync, promptVariableNameAsync } from '../../utils/prompts';

type GetFlags = {
  name?: string;
  environment?: EnvironmentVariableEnvironment;
  'non-interactive': boolean;
  format?: string;
  scope: EnvironmentVariableScope;
};

export default class EnvironmentVariableGet extends EasCommand {
  static override description = 'get environment variable';

  static override hidden = true;

  static override contextDefinition = {
    ...this.ContextOptions.ProjectConfig,
    ...this.ContextOptions.LoggedIn,
    ...this.ContextOptions.SessionManagment,
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
    const { flags } = await this.parse(EnvironmentVariableGet);

    let {
      environment,
      name,
      'non-interactive': nonInteractive,
      format,
      scope,
    } = this.validateFlags(flags);

    const {
      privateProjectConfig: { projectId },
      sessionManager,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(EnvironmentVariableGet, {
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
    if (!variable.value) {
      throw new Error(
        `${chalk.bold(
          variable.name
        )} is a secret variable and cannot be displayed once it has been created.`
      );
    }

    if (format === 'short') {
      Log.log(`${chalk.bold(variable.name)}=${variable.value}`);
    } else {
      Log.log(formatVariable(variable));
    }
  }

  private validateFlags(flags: GetFlags): GetFlags {
    if (flags.environment && flags.scope === EnvironmentVariableScope.Shared) {
      throw new Error(`Unexpected argument: --environment can only be used with project variables`);
    }
    if (flags['non-interactive']) {
      if (!flags.name) {
        throw new Error('Variable name is required. Run the command with --name flag.');
      }
      if (!flags.scope) {
        throw new Error('Scope is required. Run the command with --scope flag.');
      }
      if (!flags.environment && flags.scope === EnvironmentVariableScope.Project) {
        throw new Error('Environment is required.');
      }
    }
    return flags;
  }
}

async function getVariableAsync(
  graphqlClient: ExpoGraphqlClient,
  scope: string,
  projectId: string,
  name: string | undefined,
  environment: string | undefined
): Promise<EnvironmentVariableFragment | null> {
  if (!environment && scope === EnvironmentVariableScope.Project) {
    throw new Error('Environment is required.');
  }
  if (!name) {
    throw new Error("Variable name is required. Run the command with '--name VARIABLE_NAME' flag.");
  }
  if (environment && scope === EnvironmentVariableScope.Project) {
    const appVariables = await EnvironmentVariablesQuery.byAppIdWithSensitiveAsync(graphqlClient, {
      appId: projectId,
      environment,
      filterNames: [name],
    });
    return appVariables[0];
  }

  if (scope === EnvironmentVariableScope.Shared) {
    const sharedVariables = await EnvironmentVariablesQuery.sharedWithSensitiveAsync(
      graphqlClient,
      {
        appId: projectId,
        filterNames: [name],
      }
    );
    return sharedVariables[0];
  }

  return null;
}
