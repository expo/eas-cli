import spawnAsync from '@expo/spawn-async';
import chalk from 'chalk';

import EasCommand from '../../commandUtils/EasCommand';
import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { EASEnvironmentFlag, EASNonInteractiveFlag } from '../../commandUtils/flags';
import { EnvironmentVariableEnvironment } from '../../graphql/generated';
import { EnvironmentVariablesQuery } from '../../graphql/queries/EnvironmentVariablesQuery';
import Log from '../../log';
import { promptVariableEnvironmentAsync } from '../../utils/prompts';

type ParsedFlags =
  | {
      nonInteractive: true;
      environment: EnvironmentVariableEnvironment;
    }
  | {
      nonInteractive: false;
      environment?: EnvironmentVariableEnvironment;
    };

interface RawFlags {
  environment?: EnvironmentVariableEnvironment;
  'non-interactive': boolean;
}

export default class EnvExec extends EasCommand {
  static override description =
    'execute a bash command with environment variables from the selected environment';

  static override hidden = true;

  static override contextDefinition = {
    ...this.ContextOptions.ProjectConfig,
    ...this.ContextOptions.LoggedIn,
  };

  static override flags = {
    ...EASEnvironmentFlag,
    ...EASNonInteractiveFlag,
  };

  static override args = [
    {
      name: 'BASH_COMMAND',
      required: true,
      description: 'bash command to execute with the environment variables from the environment',
    },
  ];

  async runAsync(): Promise<void> {
    const {
      flags,
      args: { BASH_COMMAND: command },
    } = await this.parse(EnvExec);

    const parsedFlags = this.sanitizeFlags(flags);

    const {
      privateProjectConfig: { projectId },
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(EnvExec, {
      nonInteractive: parsedFlags.nonInteractive,
    });

    const environment =
      parsedFlags.environment ?? (await promptVariableEnvironmentAsync(parsedFlags.nonInteractive));
    const environmentVariables = await this.loadEnvironmentVariablesAsync({
      graphqlClient,
      projectId,
      environment,
    });

    await this.runCommandWithEnvVarsAsync({ command, environmentVariables });
  }

  private sanitizeFlags(rawFlags: RawFlags): ParsedFlags {
    const environment = rawFlags.environment;
    if (rawFlags['non-interactive']) {
      if (!environment) {
        throw new Error(
          'You must specify an environment when running in non-interactive mode. Use the --environment flag.'
        );
      }
      return {
        nonInteractive: true,
        environment,
      };
    }
    return {
      nonInteractive: false,
      environment: rawFlags.environment,
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

    const secretEnvironmentVariables = environmentVariablesQueryResult.filter(
      ({ value }) => !value
    );
    if (secretEnvironmentVariables.length > 0) {
      Log.warn(`The following environment variables are secret and cannot be downloaded locally:`);
      for (const { name } of secretEnvironmentVariables) {
        Log.warn(`- ${name}`);
      }
      Log.warn('Proceeding with the rest of the environment variables.');
      Log.newLine();
    }

    const nonSecretEnvironmentVariables = environmentVariablesQueryResult.filter(
      ({ value }) => !!value
    );
    if (nonSecretEnvironmentVariables.length === 0) {
      throw new Error('No readable environment variables found for the selected environment.');
    }
    Log.log(
      `Loaded environment variables for the selected environment "${environment.toLowerCase()}":`
    );
    for (const { name } of nonSecretEnvironmentVariables) {
      Log.log(`- ${name}`);
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
