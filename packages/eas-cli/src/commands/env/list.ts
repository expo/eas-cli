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
import { EnvironmentVariableEnvironment, EnvironmentVariableScope } from '../../graphql/generated';
import {
  EnvironmentVariableWithFileContent,
  EnvironmentVariablesQuery,
} from '../../graphql/queries/EnvironmentVariablesQuery';
import Log from '../../log';
import { promptVariableEnvironmentAsync } from '../../utils/prompts';
import { formatVariable, formatVariableValue, isEnvironment } from '../../utils/variableUtils';

async function getVariablesForScopeAsync(
  graphqlClient: ExpoGraphqlClient,
  {
    scope,
    includingSensitive,
    includeFileContent,
    environment,
    projectId,
  }: {
    scope: EnvironmentVariableScope;
    includingSensitive: boolean;
    includeFileContent: boolean;
    environment?: EnvironmentVariableEnvironment;
    projectId: string;
  }
): Promise<EnvironmentVariableWithFileContent[]> {
  if (scope === EnvironmentVariableScope.Project) {
    if (includingSensitive) {
      return await EnvironmentVariablesQuery.byAppIdWithSensitiveAsync(graphqlClient, {
        appId: projectId,
        environment,
        includeFileContent,
      });
    }
    return await EnvironmentVariablesQuery.byAppIdAsync(graphqlClient, {
      appId: projectId,
      environment,
      includeFileContent,
    });
  }

  return includingSensitive
    ? await EnvironmentVariablesQuery.sharedWithSensitiveAsync(graphqlClient, {
        appId: projectId,
        environment,
        includeFileContent,
      })
    : await EnvironmentVariablesQuery.sharedAsync(graphqlClient, {
        appId: projectId,
        environment,
        includeFileContent,
      });
}

interface RawListFlags {
  scope: EnvironmentVariableScope;
  format: string;
  environment?: EnvironmentVariableEnvironment;
  'include-sensitive': boolean;
  'include-file-content': boolean;
  'non-interactive': boolean;
}

interface ListArgs {
  scope: EnvironmentVariableScope;
  format: string;
  environment: EnvironmentVariableEnvironment;
  includeSensitive: boolean;
  includeFileContent: boolean;
  nonInteractive: boolean;
}

export default class EnvList extends EasCommand {
  static override description = 'list environment variables for the current project';

  static override hidden = true;

  static override contextDefinition = {
    ...this.ContextOptions.ProjectId,
    ...this.ContextOptions.LoggedIn,
  };

  static override flags = {
    'include-sensitive': Flags.boolean({
      description: 'Display sensitive values in the output',
      default: false,
    }),
    'include-file-content': Flags.boolean({
      description: 'Display files content in the output',
      default: false,
    }),
    ...EASEnvironmentFlag,
    ...EASVariableFormatFlag,
    ...EASVariableScopeFlag,
    ...EASNonInteractiveFlag,
  };

  static override args = [
    {
      name: 'environment',
      description:
        "Environment to list the variables from. One of 'production', 'preview', or 'development'.",
      required: false,
    },
  ];

  async runAsync(): Promise<void> {
    const { args, flags } = await this.parse(EnvList);

    const { environment, format, scope, includeFileContent, includeSensitive, nonInteractive } =
      await this.sanitizeInputsAsync(flags, args);

    const {
      projectId,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(EnvList, {
      nonInteractive,
    });

    const variables = await getVariablesForScopeAsync(graphqlClient, {
      scope,
      includingSensitive: includeSensitive,
      includeFileContent,
      environment,
      projectId,
    });

    Log.addNewLineIfNone();
    if (environment) {
      Log.log(chalk.bold(`Environment: ${environment.toLocaleLowerCase()}`));
    }

    if (variables.length === 0) {
      Log.log('No variables found for this environment.');
      return;
    }

    if (format === 'short') {
      for (const variable of variables) {
        Log.log(`${chalk.bold(variable.name)}=${formatVariableValue(variable)}`);
      }
    } else {
      if (scope === EnvironmentVariableScope.Shared) {
        Log.log(chalk.bold('Shared variables for this account:'));
      } else {
        Log.log(chalk.bold(`Variables for this project:`));
      }
      Log.log(
        variables.map(variable => formatVariable(variable)).join(`\n\n${chalk.dim('———')}\n\n`)
      );
    }
  }

  private async sanitizeInputsAsync(
    flags: RawListFlags,
    { environment: environmentInput }: Record<string, string>
  ): Promise<ListArgs> {
    if (environmentInput && !isEnvironment(environmentInput.toUpperCase())) {
      throw new Error("Invalid environment. Use one of 'production', 'preview', or 'development'.");
    }

    const environmentFromNonInteractiveInputs = flags.environment
      ? flags.environment
      : environmentInput
        ? (environmentInput.toUpperCase() as EnvironmentVariableEnvironment)
        : null;

    const environment = environmentFromNonInteractiveInputs
      ? environmentFromNonInteractiveInputs
      : await promptVariableEnvironmentAsync({ nonInteractive: flags['non-interactive'] });

    return {
      ...flags,
      nonInteractive: flags['non-interactive'],
      includeFileContent: flags['include-file-content'],
      includeSensitive: flags['include-sensitive'],
      environment,
    };
  }
}
