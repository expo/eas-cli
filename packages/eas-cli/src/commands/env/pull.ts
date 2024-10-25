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

export default class EnvironmentVariablePull extends EasCommand {
  static override description = 'pull env file';

  static override hidden = true;

  static override contextDefinition = {
    ...this.ContextOptions.ProjectId,
    ...this.ContextOptions.LoggedIn,
    ...this.ContextOptions.ProjectDir,
  };

  static override flags = {
    ...EASEnvironmentFlag,
    ...EASNonInteractiveFlag,
    path: Flags.string({
      description: 'Path to the result `.env` file',
      default: '.env.local',
    }),
  };

  async runAsync(): Promise<void> {
    let {
      flags: { environment, path: targetPath, 'non-interactive': nonInteractive },
    } = await this.parse(EnvironmentVariablePull);

    if (!environment) {
      environment = await promptVariableEnvironmentAsync({ nonInteractive });
    }
    const {
      projectId,
      loggedIn: { graphqlClient },
      projectDir,
    } = await this.getContextAsync(EnvironmentVariablePull, {
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
          return `# ${variable.name}=***** (secret variables are not available for reading)`;
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

    if (overridenSecretVariables.length > 0) {
      Log.addNewLineIfNone();
      Log.log(`Reused local values for following secrets: ${overridenSecretVariables.join('\n')}`);
    }

    if (skippedSecretVariables.length > 0) {
      Log.warn(
        `The eas env:pull command tried to pull environment variables with "secret" visibility. The variables with "secret" visibility are not available for reading, therefore thet were marked as "*****" in the generated .env file. Provide values for these manually in ${targetPath} if needed. Skipped variables: ${skippedSecretVariables.join(
          '\n'
        )}`
      );
      Log.warn();
    }

    Log.log(
      `Pulled environment variables from ${environment.toLowerCase()} environment to ${targetPath}.`
    );
  }
}
