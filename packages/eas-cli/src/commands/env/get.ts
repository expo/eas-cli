import { Flags } from '@oclif/core';
import assert from 'assert';
import chalk from 'chalk';

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
import { promptVariableEnvironmentAsync, promptVariableNameAsync } from '../../utils/prompts';
import { formatVariable } from '../../utils/variableUtils';

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
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(EnvironmentVariableGet, {
      nonInteractive,
    });

    if (!name) {
      name = await promptVariableNameAsync(nonInteractive);
    }

    if (!environment && scope === EnvironmentVariableScope.Project) {
      environment = await promptVariableEnvironmentAsync({ nonInteractive });
    }

    const variables = await getVariablesAsync(graphqlClient, scope, projectId, name, environment);

    if (variables.length === 0) {
      Log.error(`Variable with name "${name}" not found`);
      return;
    }

    let variable;

    if (variables.length > 1) {
      if (!environment) {
        environment = await promptVariableEnvironmentAsync({ nonInteractive, multiple: false });
      }

      assert(environment, 'Environment is required.');

      variable = variables.find(v => v.environments?.includes(environment!));
    }
    variable = variables[0];

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

async function getVariablesAsync(
  graphqlClient: ExpoGraphqlClient,
  scope: string,
  projectId: string,
  name: string | undefined,
  environment: EnvironmentVariableEnvironment | undefined
): Promise<EnvironmentVariableFragment[]> {
  if (!name) {
    throw new Error("Variable name is required. Run the command with '--name VARIABLE_NAME' flag.");
  }
  if (scope === EnvironmentVariableScope.Project) {
    const appVariables = await EnvironmentVariablesQuery.byAppIdWithSensitiveAsync(graphqlClient, {
      appId: projectId,
      environment,
      filterNames: [name],
    });
    return appVariables;
  } else {
    const sharedVariables = await EnvironmentVariablesQuery.sharedWithSensitiveAsync(
      graphqlClient,
      {
        appId: projectId,
        filterNames: [name],
      }
    );
    return sharedVariables;
  }
}
