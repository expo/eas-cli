import { Flags } from '@oclif/core';
import dotenv from 'dotenv';
import * as fs from 'fs-extra';
import path from 'path';

import EasCommand from '../../commandUtils/EasCommand';
import { EASEnvironmentFlag, EASNonInteractiveFlag } from '../../commandUtils/flags';
import { EnvironmentSecretType, EnvironmentVariableVisibility } from '../../graphql/generated';
import {
  EnvironmentVariableWithFileContent,
  EnvironmentVariablesQuery,
} from '../../graphql/queries/EnvironmentVariablesQuery';
import Log from '../../log';
import { confirmAsync } from '../../prompts';
import { promptVariableEnvironmentAsync } from '../../utils/prompts';
import { isEnvironment } from '../../utils/variableUtils';

export default class EnvPull extends EasCommand {
  static override description =
    'pull environment variables for the selected environment to .env file';

  static override contextDefinition = {
    ...this.ContextOptions.ProjectId,
    ...this.ContextOptions.LoggedIn,
    ...this.ContextOptions.ProjectDir,
  };

  static override args = [
    {
      name: 'environment',
      description:
        "Environment to pull variables from. One of 'production', 'preview', or 'development'.",
      required: false,
    },
  ];

  static override flags = {
    ...EASNonInteractiveFlag,
    ...EASEnvironmentFlag,
    path: Flags.string({
      description: 'Path to the result `.env` file',
      default: '.env.local',
    }),
  };

  async runAsync(): Promise<void> {
    let {
      args: { environment: argEnvironment },
      flags: { environment: flagEnvironment, path: targetPath, 'non-interactive': nonInteractive },
    } = await this.parse(EnvPull);

    let environment = flagEnvironment?.toUpperCase() ?? argEnvironment?.toUpperCase();

    if (!environment) {
      environment = await promptVariableEnvironmentAsync({ nonInteractive });
    }

    if (!isEnvironment(environment)) {
      throw new Error("Invalid environment. Use one of 'production', 'preview', or 'development'.");
    }

    const {
      projectId,
      loggedIn: { graphqlClient },
      projectDir,
    } = await this.getContextAsync(EnvPull, {
      nonInteractive,
    });

    targetPath = targetPath ?? '.env.local';

    const environmentVariables = await EnvironmentVariablesQuery.byAppIdWithSensitiveAsync(
      graphqlClient,
      {
        appId: projectId,
        environment,
        includeFileContent: true,
      }
    );

    if (!nonInteractive && (await fs.exists(targetPath))) {
      const result = await confirmAsync({
        message: `File ${targetPath} already exists. Do you want to overwrite it?`,
      });
      if (!result) {
        Log.log('Aborting...');
        throw new Error(`File ${targetPath} already exists.`);
      }
    }

    let currentEnvLocal: Record<string, string> = {};

    if (await fs.exists(targetPath)) {
      currentEnvLocal = dotenv.parse(await fs.readFile(targetPath, 'utf8'));
    }

    const filePrefix = `# Environment: ${environment.toLocaleLowerCase()}\n\n`;

    const isFileVariablePresent = environmentVariables.some(v => {
      return v.type === EnvironmentSecretType.FileBase64 && v.valueWithFileContent;
    });

    const envDir = path.join(projectDir, '.eas', '.env');
    if (isFileVariablePresent) {
      await fs.mkdir(envDir, { recursive: true });
    }

    const skippedSecretVariables: string[] = [];
    const overridenSecretVariables: string[] = [];

    const envFileContentLines = await Promise.all(
      environmentVariables.map(async (variable: EnvironmentVariableWithFileContent) => {
        if (variable.visibility === EnvironmentVariableVisibility.Secret) {
          if (currentEnvLocal[variable.name]) {
            overridenSecretVariables.push(variable.name);
            return `${variable.name}=${currentEnvLocal[variable.name]}`;
          }
          skippedSecretVariables.push(variable.name);
          return `# ${variable.name}=***** (secret)`;
        }
        if (variable.type === EnvironmentSecretType.FileBase64 && variable.valueWithFileContent) {
          const filePath = path.join(envDir, variable.name);
          await fs.writeFile(filePath, variable.valueWithFileContent, 'base64');
          return `${variable.name}=${filePath}`;
        }
        return `${variable.name}=${variable.value}`;
      })
    );

    await fs.writeFile(targetPath, filePrefix + envFileContentLines.join('\n'));

    Log.log(
      `Pulled plain text and sensitive environment variables from "${environment.toLowerCase()}" environment to ${targetPath}.`
    );

    if (overridenSecretVariables.length > 0) {
      Log.addNewLineIfNone();
      Log.log(`Reused local values for following secrets: ${overridenSecretVariables.join('\n')}.`);
    }

    if (skippedSecretVariables.length > 0) {
      Log.addNewLineIfNone();
      Log.log(
        `The following variables have the secret visibility and can't be read outside of EAS servers. Set their values manually in your .env file: ${skippedSecretVariables.join(
          ', '
        )}.`
      );
    }
  }
}
