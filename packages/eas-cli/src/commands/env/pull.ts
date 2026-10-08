import { Args, Flags } from '@oclif/core';
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

/**
 * Serialize a value so that it round-trips through a dotenv parser.
 *
 * Without quoting, dotenv treats an unquoted `#` as the start of an inline comment, trims
 * surrounding whitespace and splits on newlines, so values like a `#ffffff` hex color or a URL
 * with a fragment would be silently truncated when the `.env` file is read back. See
 * https://github.com/motdotla/dotenv#comments.
 *
 * Single quotes are preferred because dotenv treats single-quoted values as literal, preserving
 * `#`, whitespace, backslashes and double quotes as-is. Double quotes (with `\n`/`\r` escaping) are
 * only used when the value contains a single quote or a newline.
 */
export function serializeDotenvValue(value: string): string {
  // Values made up of "safe" characters can be written verbatim.
  if (value !== '' && !/[\s#'"`\\]/.test(value)) {
    return value;
  }
  if (!value.includes("'") && !/[\r\n]/.test(value)) {
    return `'${value}'`;
  }
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
  return `"${escaped}"`;
}

export default class EnvPull extends EasCommand {
  static override description =
    'pull environment variables for the selected environment to .env file';

  static override contextDefinition = {
    ...this.ContextOptions.ProjectId,
    ...this.ContextOptions.LoggedIn,
    ...this.ContextOptions.ProjectDir,
  };

  static override args = {
    environment: Args.string({
      description:
        "Environment to pull variables from. Default environments are 'production', 'preview', and 'development'.",
      required: false,
    }),
  };

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

    let environment = flagEnvironment?.toLowerCase() ?? argEnvironment?.toLowerCase();

    const {
      projectId,
      loggedIn: { graphqlClient },
      projectDir,
    } = await this.getContextAsync(EnvPull, {
      nonInteractive,
    });

    if (!environment) {
      environment = await promptVariableEnvironmentAsync({
        nonInteractive,
        graphqlClient,
        projectId,
      });
    }

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
            return `${variable.name}=${serializeDotenvValue(currentEnvLocal[variable.name])}`;
          }
          skippedSecretVariables.push(variable.name);
          return `# ${variable.name}=***** (secret)`;
        }
        if (variable.type === EnvironmentSecretType.FileBase64 && variable.valueWithFileContent) {
          const filePath = path.join(envDir, variable.name);
          await fs.writeFile(filePath, variable.valueWithFileContent, 'base64');
          return `${variable.name}=${serializeDotenvValue(filePath)}`;
        }
        return `${variable.name}=${serializeDotenvValue(variable.value ?? '')}`;
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
