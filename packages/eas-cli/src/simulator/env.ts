import { loadProjectEnv, loadEnvFiles } from '@expo/env';
import path from 'path';

export const SIMULATOR_DOTENV_FILE_NAME = '.env.eas-simulator';

export function getSimulatorDotenvFilePath(projectDir: string): string {
  return path.join(projectDir, SIMULATOR_DOTENV_FILE_NAME);
}

export async function loadSimulatorEnvironmentVariablesAsync(projectDir: string): Promise<void> {
  const simulatorDotenvFilePath = getSimulatorDotenvFilePath(projectDir);

  loadProjectEnv(projectDir);
  loadEnvFiles([simulatorDotenvFilePath], { force: true });
}
