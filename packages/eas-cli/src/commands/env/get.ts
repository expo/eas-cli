import { Flags } from '@oclif/core';
import assert from 'assert';
import chalk from 'chalk';

import EasCommand from '../../commandUtils/EasCommand';
import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import {
  EASNonInteractiveFlag,
  EASVariableFormatFlag,
  EASVariableScopeFlag,
  EasEnvironmentFlagParameters,
} from '../../commandUtils/flags';
import {
  EnvironmentVariableEnvironment,
  EnvironmentVariableFragment,
  EnvironmentVariableScope,
  EnvironmentVariableVisibility,
} from '../../graphql/generated';
import { EnvironmentVariablesQuery } from '../../graphql/queries/EnvironmentVariablesQuery';
import Log from '../../log';
import { promptVariableEnvironmentAsync, promptVariableNameAsync } from '../../utils/prompts';
import { formatVariable, formatVariableValue } from '../../utils/variableUtils';

type GetFlags = {
  'variable-name'?: string;
  'variable-environment'?: EnvironmentVariableEnvironment;
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
    'variable-name': Flags.string({
      description: 'Name of the variable',
    }),
    'variable-environment': Flags.enum<EnvironmentVariableEnvironment>({
      ...EasEnvironmentFlagParameters,
      description: 'Current environment of the variable',
    }),
    ...EASVariableFormatFlag,
    ...EASVariableScopeFlag,
    ...EASNonInteractiveFlag,
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(EnvironmentVariableGet);

    let {
      'variable-environment': environment,
      'variable-name': name,
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

    const variables = await getVariablesAsync(graphqlClient, scope, projectId, name, environment);

    if (variables.length === 0) {
      Log.error(`Variable with name "${name}" not found`);
      return;
    }

    let variable;

    if (variables.length > 1) {
      if (!environment) {
        const availableEnvironments = variables.reduce<EnvironmentVariableEnvironment[]>(
          (acc, v) => [...acc, ...(v.environments ?? [])],
          [] as EnvironmentVariableEnvironment[]
        );

        environment = await promptVariableEnvironmentAsync({
          nonInteractive,
          multiple: false,
          availableEnvironments,
        });
      }

      assert(environment, 'Environment is required.');

      const variableInEnvironment = variables.find(v => v.environments?.includes(environment!));
      if (!variableInEnvironment) {
        throw new Error(`Variable with name "${name}" not found in environment "${environment}"`);
      }

      variable = variableInEnvironment;
    } else {
      variable = variables[0];
    }

    if (variable.visibility === EnvironmentVariableVisibility.Secret) {
      throw new Error(
        `${chalk.bold(
          variable.name
        )} is a secret variable and cannot be displayed once it has been created.`
      );
    }

    if (format === 'short') {
      Log.log(`${chalk.bold(variable.name)}=${formatVariableValue(variable)}`);
    } else {
      Log.log(formatVariable(variable));
    }
  }

  private validateFlags(flags: GetFlags): GetFlags {
    if (flags['non-interactive']) {
      if (!flags['variable-name']) {
        throw new Error('Variable name is required. Run the command with --variable-name flag.');
      }
      if (!flags.scope) {
        throw new Error('Scope is required. Run the command with --scope flag.');
      }
      if (!flags['variable-environment']) {
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
    throw new Error(
      "Variable name is required. Run the command with '--variable-name VARIABLE_NAME' flag."
    );
  }
  if (scope === EnvironmentVariableScope.Project) {
    const appVariables = await EnvironmentVariablesQuery.byAppIdWithSensitiveAsync(graphqlClient, {
      appId: projectId,
      environment,
      filterNames: [name],
      includeFileContent: true,
    });
    return appVariables;
  } else {
    const sharedVariables = await EnvironmentVariablesQuery.sharedWithSensitiveAsync(
      graphqlClient,
      {
        appId: projectId,
        filterNames: [name],
        includeFileContent: true,
      }
    );
    return sharedVariables;
  }
}
