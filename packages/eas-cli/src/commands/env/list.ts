import { Flags } from '@oclif/core';
import chalk from 'chalk';

import EasCommand from '../../commandUtils/EasCommand';
import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import {
  EASEnvironmentVariableScopeFlag,
  EASEnvironmentVariableScopeFlagValue,
  EASMultiEnvironmentFlag,
  EASVariableFormatFlag,
} from '../../commandUtils/flags';
import { EnvironmentVariableScope } from '../../graphql/generated';
import {
  EnvironmentVariableWithFileContent,
  EnvironmentVariablesQuery,
} from '../../graphql/queries/EnvironmentVariablesQuery';
import Log from '../../log';
import { promptVariableEnvironmentAsync } from '../../utils/prompts';
import {
  formatVariable,
  formatVariableValue,
  performForEnvironmentsAsync,
} from '../../utils/variableUtils';

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
    environment?: string;
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
  scope: EASEnvironmentVariableScopeFlagValue;
  format: string;
  environment: string[] | undefined;
  'include-sensitive': boolean;
  'include-file-content': boolean;
  'non-interactive'?: boolean;
}

interface ListFlags {
  scope: EnvironmentVariableScope;
  format: string;
  environment: string[] | undefined;
  'include-sensitive': boolean;
  'include-file-content': boolean;
  'non-interactive': boolean;
}

export default class EnvList extends EasCommand {
  static override description = 'list environment variables for the current project or account';

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
    ...EASMultiEnvironmentFlag,
    ...EASVariableFormatFlag,
    ...EASEnvironmentVariableScopeFlag,
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

    let {
      format,
      environment: environments,
      scope,
      'include-sensitive': includeSensitive,
      'include-file-content': includeFileContent,
      'non-interactive': nonInteractive,
    } = this.sanitizeInputs(flags, args);

    const {
      projectId,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(EnvList, {
      nonInteractive: true,
    });

    if (!environments) {
      environments = await promptVariableEnvironmentAsync({ nonInteractive, multiple: true });
    }

    await performForEnvironmentsAsync(environments, async environment => {
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
          Log.log(chalk.bold('Account-wide variables for this account:'));
        } else {
          Log.log(chalk.bold(`Variables for this project:`));
        }
        Log.log(
          variables.map(variable => formatVariable(variable)).join(`\n\n${chalk.dim('———')}\n\n`)
        );
      }
    });
  }

  private sanitizeInputs(
    flags: RawListFlags,
    { environment }: { environment?: string }
  ): ListFlags {
    const environments = flags.environment
      ? flags.environment
      : environment
        ? [environment]
        : undefined;

    return {
      ...flags,
      'non-interactive': flags['non-interactive'] ?? false,
      environment: environments,
      scope:
        flags.scope === 'account'
          ? EnvironmentVariableScope.Shared
          : EnvironmentVariableScope.Project,
    };
  }
}
