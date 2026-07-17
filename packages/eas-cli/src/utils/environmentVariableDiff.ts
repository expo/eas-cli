import chalk from 'chalk';
import dotenv from 'dotenv';
import fs from 'fs-extra';
import path from 'path';

import { EnvironmentSecretType, EnvironmentVariableVisibility } from '../graphql/generated';
import { EnvironmentVariableWithFileContent } from '../graphql/queries/EnvironmentVariablesQuery';

interface EnvironmentVariableDiffOptions {
  environmentVariables: EnvironmentVariableWithFileContent[];
  currentEnvValues: Record<string, string>;
  existingVariableNames: Set<string>;
  envDir: string;
  targetExists: boolean;
}

export function getEnvironmentVariableNamesFromEnvFile(contents: string): {
  values: Record<string, string>;
  variableNames: Set<string>;
} {
  const values = dotenv.parse(contents);
  const variableNames = new Set(Object.keys(values));
  const secretPlaceholderPattern = /^#\s+([^=\s]+)=\*{5}\s+\(secret\)\s*$/gm;

  for (const match of contents.matchAll(secretPlaceholderPattern)) {
    variableNames.add(match[1]);
  }

  return { values, variableNames };
}

async function isFileVariableUnchangedAsync(
  currentEnvValue: string | undefined,
  newVariable: EnvironmentVariableWithFileContent,
  envDir: string
): Promise<boolean> {
  const expectedFilePath = path.join(envDir, newVariable.name);
  if (currentEnvValue !== expectedFilePath || !newVariable.valueWithFileContent) {
    return false;
  }

  try {
    if (!(await fs.pathExists(currentEnvValue))) {
      return false;
    }
    return (await fs.readFile(currentEnvValue, 'base64')) === newVariable.valueWithFileContent;
  } catch {
    // Diff rendering should never prevent env:pull from replacing an unreadable file.
    return false;
  }
}

async function isEnvironmentVariableUnchangedAsync(
  currentEnvValue: string | undefined,
  newVariable: EnvironmentVariableWithFileContent,
  envDir: string
): Promise<boolean> {
  if (newVariable.visibility === EnvironmentVariableVisibility.Secret) {
    // env:pull preserves an existing local secret; it cannot compare it with the remote value.
    return true;
  }
  if (newVariable.type === EnvironmentSecretType.FileBase64) {
    return await isFileVariableUnchangedAsync(currentEnvValue, newVariable, envDir);
  }
  return currentEnvValue === newVariable.value;
}

export async function formatEnvironmentVariableDiffAsync({
  environmentVariables,
  currentEnvValues,
  existingVariableNames,
  envDir,
  targetExists,
}: EnvironmentVariableDiffOptions): Promise<string[]> {
  if (!targetExists) {
    return environmentVariables.map(variable => `  ${variable.name}`);
  }

  const newVariablesByName = new Map(
    environmentVariables.map(variable => [variable.name, variable])
  );
  const diffLog: string[] = [];

  for (const variable of environmentVariables) {
    if (!existingVariableNames.has(variable.name)) {
      diffLog.push(chalk.green(`+ ${variable.name}`));
    } else if (
      await isEnvironmentVariableUnchangedAsync(currentEnvValues[variable.name], variable, envDir)
    ) {
      diffLog.push(`  ${variable.name}`);
    } else {
      diffLog.push(chalk.yellow(`~ ${variable.name}`));
    }
  }

  for (const variableName of existingVariableNames) {
    if (!newVariablesByName.has(variableName)) {
      diffLog.push(chalk.red(`- ${variableName}`));
    }
  }

  return diffLog;
}
