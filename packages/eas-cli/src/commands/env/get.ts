import { Flags } from '@oclif/core';
import chalk from 'chalk';

import EasCommand from '../../commandUtils/EasCommand';
import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import {
  EASEnvironmentVariableScopeFlag,
  EASEnvironmentVariableScopeFlagValue,
  EASNonInteractiveFlag,
  EASVariableFormatFlag,
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
import { formatVariable, formatVariableValue, isEnvironment } from '../../utils/variableUtils';

interface RawGetFlags {
  'variable-name'?: string;
  'variable-environment'?: EnvironmentVariableEnvironment;
  'non-interactive': boolean;
  format?: string;
  scope: EASEnvironmentVariableScopeFlagValue;
}

interface GetFlags {
  'variable-name'?: string;
  'variable-environment'?: EnvironmentVariableEnvironment;
  'non-interactive': boolean;
  format?: string;
  scope: EnvironmentVariableScope;
}

export default class EnvGet extends EasCommand {
  static override description = 'view an environment variable for the current project or account';

  static override contextDefinition = {
    ...this.ContextOptions.ProjectId,
    ...this.ContextOptions.LoggedIn,
  };

  static override args = [
    {
      name: 'environment',
      description:
        "Current environment of the variable. One of 'production', 'preview', or 'development'.",
      required: false,
    },
  ];

  static override flags = {
    'variable-name': Flags.string({
      description: 'Name of the variable',
    }),
    'variable-environment': Flags.enum<EnvironmentVariableEnvironment>({
      ...EasEnvironmentFlagParameters,
      description: 'Current environment of the variable',
    }),
    ...EASVariableFormatFlag,
    ...EASEnvironmentVariableScopeFlag,
    ...EASNonInteractiveFlag,
  };

  async runAsync(): Promise<void> {
    const { args, flags } = await this.parse(EnvGet);

    let {
      'variable-environment': environment,
      'variable-name': name,
      'non-interactive': nonInteractive,
      format,
      scope,
    } = this.sanitizeInputs(flags, args);

    const {
      projectId,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(EnvGet, {
      nonInteractive,
    });

    if (!name) {
      name = await promptVariableNameAsync(nonInteractive);
    }

    if (!environment) {
      environment = await promptVariableEnvironmentAsync({
        nonInteractive,
        multiple: false,
      });
    }

    const variables = await getVariablesAsync(graphqlClient, scope, projectId, name, environment);

    if (variables.length === 0) {
      Log.error(`Variable with name "${name}" not found`);
      return;
    }

    let variable;

    if (variables.length > 1) {
      const variableInEnvironment = variables.find(v => v.environments?.includes(environment!));
      if (!variableInEnvironment) {
        throw new Error(
          `Variable with name "${name}" not found in environment "${environment.toLocaleLowerCase()}"`
        );
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

  private sanitizeInputs(flags: RawGetFlags, { environment }: { environment?: string }): GetFlags {
    if (flags['non-interactive']) {
      if (!flags['variable-name']) {
        throw new Error('Variable name is required. Run the command with --variable-name flag.');
      }
      if (!flags.scope) {
        throw new Error('Scope is required. Run the command with --scope flag.');
      }
      if (!(flags['variable-environment'] ?? environment)) {
        throw new Error('Environment is required.');
      }
    }
    if (environment && flags['variable-environment']) {
      throw new Error(
        "You can't use both --variable-environment flag when environment is passed as an argument. Run `eas env:get --help` for more information."
      );
    }

    const scope =
      flags.scope === 'account'
        ? EnvironmentVariableScope.Shared
        : EnvironmentVariableScope.Project;
    if (environment) {
      environment = environment.toUpperCase();
      if (!isEnvironment(environment)) {
        throw new Error(
          "Invalid environment. Use one of 'production', 'preview', or 'development'."
        );
      }
      return {
        ...flags,
        'variable-environment': environment,
        scope,
      };
    }
    return { ...flags, scope };
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
