import { BuildStepEnv } from '@expo/steps';
import { bunyan } from '@expo/logger';

import {
  ExpoFingerprintCLICommandFailedError,
  ExpoFingerprintCLIInvalidCommandError,
  ExpoFingerprintCLIModuleNotFoundError,
  expoFingerprintCommandAsync,
  isModernExpoFingerprintCLISupportedAsync,
} from './expoFingerprintCli';

export async function diffFingerprintsAsync(
  projectDir: string,
  fingerprint1File: string,
  fingerprint2File: string,
  { env, logger }: { env: BuildStepEnv; logger: bunyan }
): Promise<string | null> {
  if (!(await isModernExpoFingerprintCLISupportedAsync(projectDir))) {
    logger.debug('Fingerprint diff not available');
    return null;
  }

  try {
    return await expoFingerprintCommandAsync(
      projectDir,
      ['fingerprint:diff', fingerprint1File, fingerprint2File],
      {
        env,
      }
    );
  } catch (e) {
    if (
      e instanceof ExpoFingerprintCLIModuleNotFoundError ||
      e instanceof ExpoFingerprintCLICommandFailedError ||
      e instanceof ExpoFingerprintCLIInvalidCommandError
    ) {
      logger.debug('Fingerprint diff not available');
      return null;
    }
    throw e;
  }
}
