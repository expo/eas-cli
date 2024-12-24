import spawnAsync from '@expo/spawn-async';
import chalk from 'chalk';

import EasCommand from '../../commandUtils/EasCommand';
import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { EASNonInteractiveFlag } from '../../commandUtils/flags';
import { EnvironmentVariableEnvironment } from '../../graphql/generated';
import { EnvironmentVariablesQuery } from '../../graphql/queries/EnvironmentVariablesQuery';
import Log from '../../log';
import { promptVariableEnvironmentAsync } from '../../utils/prompts';
import { isEnvironment } from '../../utils/variableUtils';

type ParsedFlags =
  | {
      nonInteractive: true;
      environment: EnvironmentVariableEnvironment;
      command: string;
    }
  | {
      nonInteractive: false;
      environment?: EnvironmentVariableEnvironment;
      command: string;
    };

interface RawFlags {
  'non-interactive': boolean;
}

export default class EnvExec extends EasCommand {
  static override description =
    'execute a command with environment variables from the selected environment';

  static override contextDefinition = {
    ...this.ContextOptions.ProjectId,
    ...this.ContextOptions.LoggedIn,
  };

  static override flags = {
    ...EASNonInteractiveFlag,
  };

  static override args = [
    {
      name: 'environment',
      required: true,
      description:
        "Environment to execute the command in. One of 'production', 'preview', or 'development'.",
    },
    {
      name: 'bash_command',
      required: true,
      description: 'bash command to execute with the environment variables from the environment',
    },
  ];

  async runAsync(): Promise<void> {
    const { flags, args } = await this.parse(EnvExec);

    const parsedFlags = this.sanitizeFlagsAndArgs(flags, args);

    const {
      projectId,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(EnvExec, {
      nonInteractive: parsedFlags.nonInteractive,
    });

    const environment =
      parsedFlags.environment ??
      (await promptVariableEnvironmentAsync({ nonInteractive: parsedFlags.nonInteractive }));
    const environmentVariables = await this.loadEnvironmentVariablesAsync({
      graphqlClient,
      projectId,
      environment,
    });

    await this.runCommandWithEnvVarsAsync({
      command: parsedFlags.command,
      environmentVariables,
    });
  }

  private sanitizeFlagsAndArgs(
    rawFlags: RawFlags,
    { bash_command, environment }: Record<string, string>
  ): ParsedFlags {
    if (rawFlags['non-interactive'] && (!bash_command || !environment)) {
      throw new Error(
        "You must specify both environment and bash command when running in non-interactive mode. Run command as `eas env:exec ENVIRONMENT 'bash command'`."
      );
    }

    environment = environment?.toUpperCase();

    if (!isEnvironment(environment)) {
      throw new Error("Invalid environment. Use one of 'production', 'preview', or 'development'.");
    }

    return {
      nonInteractive: rawFlags['non-interactive'],
      environment,
      command: bash_command,
    };
  }

  private async runCommandWithEnvVarsAsync({
    command,
    environmentVariables,
  }: {
    command: string;
    environmentVariables: Record<string, string>;
  }): Promise<void> {
    Log.log(`Running command: ${chalk.bold(command)}`);
    const spawnPromise = spawnAsync('bash', ['-c', command], {
      stdio: ['inherit', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ...environmentVariables,
      },
    });
    const {
      child: { stdout, stderr },
    } = spawnPromise;
    if (!stdout || !stderr) {
      throw new Error(`Failed to spawn ${command}`);
    }
    stdout.on('data', data => {
      for (const line of data.toString().trim().split('\n')) {
        Log.log(`${chalk.gray('[stdout]')} ${line}`);
      }
    });
    stderr.on('data', data => {
      for (const line of data.toString().trim().split('\n')) {
        Log.warn(`${chalk.gray('[stderr]')} ${line}`);
      }
    });

    try {
      await spawnPromise;
    } catch (error) {
      Log.error(`❌ ${chalk.bold(command)} failed`);
      throw error;
    }
  }

  private async loadEnvironmentVariablesAsync({
    graphqlClient,
    projectId,
    environment,
  }: {
    graphqlClient: ExpoGraphqlClient;
    projectId: string;
    environment: EnvironmentVariableEnvironment;
  }): Promise<Record<string, string>> {
    const environmentVariablesQueryResult =
      await EnvironmentVariablesQuery.byAppIdWithSensitiveAsync(graphqlClient, {
        appId: projectId,
        environment,
      });

    const nonSecretEnvironmentVariables = environmentVariablesQueryResult.filter(
      ({ value }) => !!value
    );

    if (nonSecretEnvironmentVariables.length > 0) {
      Log.log(
        `Environment variables with visibility "Plain text" and "Sensitive" loaded from the "${environment.toLowerCase()}" environment on EAS: ${nonSecretEnvironmentVariables
          .map(e => e.name)
          .join(', ')}.`
      );
    } else {
      Log.log(
        `No environment variables with visibility "Plain text" and "Sensitive" found for the "${environment.toLowerCase()}" environment on EAS.`
      );
    }
    Log.newLine();

    const environmentVariables: Record<string, string> = {};
    for (const { name, value } of nonSecretEnvironmentVariables) {
      if (value) {
        environmentVariables[name] = value;
      }
    }
    return environmentVariables;
  }
}
