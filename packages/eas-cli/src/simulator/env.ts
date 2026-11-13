import { loadEnvFiles, loadProjectEnv } from '@expo/env';
import { parse as parseDotenv } from 'dotenv';
import * as fs from 'fs-extra';
import path from 'path';

import Log from '../log';

export const SIMULATOR_DOTENV_FILE_NAME = '.env.eas-simulator';
export const EAS_SIMULATOR_SESSION_ID = 'EAS_SIMULATOR_SESSION_ID';
// "starting" until the session is ready. `eas simulator:exec` refuses to run while it is set,
// because the file does not hold the session's connection variables yet. Write it before
// EAS_SIMULATOR_SESSION_ID so that a reader which sees the session ID also sees the status.
export const EAS_SIMULATOR_SESSION_STATUS = 'EAS_SIMULATOR_SESSION_STATUS';
export const EAS_SIMULATOR_SESSION_STATUS_STARTING = 'starting';
// Written for sessions started with `--egress local`; read by `eas simulator:egress`.
export const EAS_SIMULATOR_EGRESS_URL = 'EAS_SIMULATOR_EGRESS_URL';
export const EAS_SIMULATOR_EGRESS_TOKEN = 'EAS_SIMULATOR_EGRESS_TOKEN';
export const EAS_SIMULATOR_EGRESS_FINGERPRINT = 'EAS_SIMULATOR_EGRESS_FINGERPRINT';
export const EAS_SIMULATOR_EGRESS_PORT = 'EAS_SIMULATOR_EGRESS_PORT';
// Comma-separated host:port destinations from `--egress-allow`.
export const EAS_SIMULATOR_EGRESS_ALLOW = 'EAS_SIMULATOR_EGRESS_ALLOW';
// "android" or "ios"; older sessions without it are iOS.
export const EAS_SIMULATOR_EGRESS_PLATFORM = 'EAS_SIMULATOR_EGRESS_PLATFORM';
export const SIMULATOR_DOTENV_FILE_HEADER =
  '# Do not commit this file.\n# Do not modify these values manually. They are managed by eas-cli.\n# It holds configuration only for the current simulator session.\n\n';

export function getSimulatorEnvFilePath(projectDir: string): string {
  return path.join(projectDir, SIMULATOR_DOTENV_FILE_NAME);
}

/**
 * @returns the variables in the simulator dotenv file, or null when the file does not exist.
 */
export async function readSimulatorEnvAsync(
  projectDir: string
): Promise<Record<string, string> | null> {
  try {
    return parseDotenv(await fs.readFile(getSimulatorEnvFilePath(projectDir), 'utf8'));
  } catch (err) {
    if (typeof err === 'object' && err !== null && 'code' in err && err.code === 'ENOENT') {
      return null;
    }
    throw err;
  }
}

export async function loadSimulatorEnvAsync(projectDir: string): Promise<void> {
  loadProjectEnv(projectDir, { silent: true });
  applySimulatorEnv(await readSimulatorEnvAsync(projectDir));
  loadEnvFiles([getSimulatorEnvFilePath(projectDir)], { force: true });
}

/**
 * Sets the session variables from the simulator dotenv file in process.env, and removes the
 * session variables that the file does not have.
 */
export function applySimulatorEnv(simulatorEnv: Record<string, string> | null): void {
  if (!simulatorEnv?.[EAS_SIMULATOR_SESSION_ID] && !simulatorEnv?.[EAS_SIMULATOR_EGRESS_URL]) {
    return;
  }
  // loadEnvFiles never replaces existing variables, even with force: true.
  // Keep this session's credentials and destination policy together rather
  // than combining them with values exported for an older session.
  for (const key of [
    EAS_SIMULATOR_SESSION_ID,
    EAS_SIMULATOR_SESSION_STATUS,
    'AGENT_DEVICE_DAEMON_BASE_URL',
    'AGENT_DEVICE_DAEMON_AUTH_TOKEN',
    'ARGENT_TOOLS_URL',
    'ARGENT_AUTH_TOKEN',
    'APPIUM_URL',
    'APPIUM_CAPS',
    EAS_SIMULATOR_EGRESS_URL,
    EAS_SIMULATOR_EGRESS_TOKEN,
    EAS_SIMULATOR_EGRESS_FINGERPRINT,
    EAS_SIMULATOR_EGRESS_PORT,
    EAS_SIMULATOR_EGRESS_PLATFORM,
  ]) {
    if (simulatorEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = simulatorEnv[key];
    }
  }
  process.env[EAS_SIMULATOR_EGRESS_ALLOW] = simulatorEnv[EAS_SIMULATOR_EGRESS_ALLOW] ?? '';
}

export async function writeSimulatorEnvAsync(
  projectDir: string,
  environmentVariables: Record<string, string>
): Promise<void> {
  const simulatorDotenvFilePath = getSimulatorEnvFilePath(projectDir);
  const simulatorDotenvContent =
    SIMULATOR_DOTENV_FILE_HEADER +
    Object.entries(environmentVariables)
      .map(([key, value]) => `${key}='${value}'`)
      .join('\n') +
    '\n';

  await fs.writeFile(simulatorDotenvFilePath, simulatorDotenvContent);
}

export async function resetSimulatorEnvAsync(
  projectDir: string,
  expectedDeviceRunSessionId: string
): Promise<void> {
  const simulatorDotenvFilePath = getSimulatorEnvFilePath(projectDir);

  try {
    const currentEnv = parseDotenv(await fs.readFile(simulatorDotenvFilePath, 'utf8'));
    if (currentEnv[EAS_SIMULATOR_SESSION_ID] !== expectedDeviceRunSessionId) {
      // The file was overwritten by a newer simulator session, so it is no longer
      // ours to reset. This is expected when sessions overlap; log at debug level
      // for troubleshooting without surfacing noise during normal use.
      Log.debug(
        `Skipping ${SIMULATOR_DOTENV_FILE_NAME} reset: it belongs to simulator session ${
          currentEnv[EAS_SIMULATOR_SESSION_ID] ?? '(unknown)'
        }, not ${expectedDeviceRunSessionId}.`
      );
      return;
    }
    await fs.writeFile(simulatorDotenvFilePath, SIMULATOR_DOTENV_FILE_HEADER, { flag: 'r+' });
    await fs.truncate(simulatorDotenvFilePath, Buffer.byteLength(SIMULATOR_DOTENV_FILE_HEADER));
  } catch (err) {
    if (typeof err === 'object' && err !== null && 'code' in err && err.code === 'ENOENT') {
      return;
    }

    throw err;
  }
}
