import { loadEnvFiles, loadProjectEnv } from '@expo/env';
import * as fs from 'fs-extra';
import path from 'path';

export const SIMULATOR_DOTENV_FILE_NAME = '.env.eas-simulator';
export const EAS_SIMULATOR_SESSION_ID = 'EAS_SIMULATOR_SESSION_ID';
export const SIMULATOR_DOTENV_FILE_HEADER =
  '# Do not commit this file.\n# It holds configuration only for the current simulator session.\n\n';

export function getSimulatorEnvFilePath(projectDir: string): string {
  return path.join(projectDir, SIMULATOR_DOTENV_FILE_NAME);
}

export async function loadSimulatorEnvAsync(projectDir: string): Promise<void> {
  const simulatorDotenvFilePath = getSimulatorEnvFilePath(projectDir);

  loadProjectEnv(projectDir, { silent: true });
  loadEnvFiles([simulatorDotenvFilePath], { force: true });
}

export async function writeSimulatorEnvAsync(
  projectDir: string,
  environmentVariables: Record<string, string>
): Promise<void> {
  const simulatorDotenvFilePath = getSimulatorEnvFilePath(projectDir);
  const simulatorDotenvContent =
    SIMULATOR_DOTENV_FILE_HEADER +
    Object.entries(environmentVariables)
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join('\n') +
    '\n';

  await fs.writeFile(simulatorDotenvFilePath, simulatorDotenvContent);
}

export async function resetSimulatorEnvAsync(projectDir: string): Promise<void> {
  const simulatorDotenvFilePath = getSimulatorEnvFilePath(projectDir);

  try {
    await fs.writeFile(simulatorDotenvFilePath, SIMULATOR_DOTENV_FILE_HEADER, { flag: 'r+' });
    await fs.truncate(simulatorDotenvFilePath, Buffer.byteLength(SIMULATOR_DOTENV_FILE_HEADER));
  } catch (err) {
    if (typeof err === 'object' && err !== null && 'code' in err && err.code === 'ENOENT') {
      return;
    }

    throw err;
  }
}
