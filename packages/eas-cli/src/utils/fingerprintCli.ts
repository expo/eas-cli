import { Env, Workflow } from '@expo/eas-build-job';
import { silent as silentResolveFrom } from 'resolve-from';

import mapMapAsync from './expodash/mapMapAsync';
import Log from '../log';
import { ora } from '../ora';

export async function createFingerprintAsync(
  projectDir: string,
  options: {
    workflow: Workflow;
    platforms: string[];
    debug?: boolean;
    env: Env | undefined;
    cwd?: string;
  }
): Promise<{
  hash: string;
  sources: object[];
  isDebugSource: boolean;
} | null> {
  // @expo/fingerprint is exported in the expo package for SDK 52+
  const fingerprintPath = silentResolveFrom(projectDir, 'expo/fingerprint');
  if (!fingerprintPath) {
    return null;
  }

  if (process.env.EAS_SKIP_AUTO_FINGERPRINT) {
    Log.log('Skipping project fingerprint');
    return null;
  }

  const timeoutId = setTimeout(() => {
    Log.log('⌛️ Computing the project fingerprint is taking longer than expected...');
    Log.log('⏩ To skip this step, set the environment variable: EAS_SKIP_AUTO_FINGERPRINT=1');
  }, 5000);

  const spinner = ora(`Computing project fingerprint`).start();
  try {
    const fingerprint = await createFingerprintWithoutLoggingAsync(
      projectDir,
      fingerprintPath,
      options
    );
    spinner.succeed(`Computed project fingerprint`);
    return fingerprint;
  } catch (e) {
    spinner.fail(`Failed to compute project fingerprint`);
    Log.log('⏩ To skip this step, set the environment variable: EAS_SKIP_AUTO_FINGERPRINT=1');
    throw e;
  } finally {
    // Clear the timeout if the operation finishes before the time limit
    clearTimeout(timeoutId);
    spinner.stop();
  }
}

async function createFingerprintWithoutLoggingAsync(
  projectDir: string,
  fingerprintPath: string,
  options: {
    workflow: Workflow;
    platforms: string[];
    debug?: boolean;
    env: Env | undefined;
    cwd?: string;
  }
): Promise<{
  hash: string;
  sources: object[];
  isDebugSource: boolean;
}> {
  const Fingerprint = require(fingerprintPath);
  const fingerprintOptions: Record<string, any> = {};
  if (options.platforms) {
    fingerprintOptions.platforms = [...options.platforms];
  }
  if (options.workflow === Workflow.MANAGED) {
    fingerprintOptions.ignorePaths = ['android/**/*', 'ios/**/*'];
  }
  if (options.debug) {
    fingerprintOptions.debug = true;
  }
  // eslint-disable-next-line @typescript-eslint/return-await
  return await Fingerprint.createFingerprintAsync(projectDir, fingerprintOptions);
}

/**
 * Computes project fingerprints based on provided options and returns a map of fingerprint data keyed by a string.
 *
 * @param projectDir - The root directory of the project.
 * @param fingerprintOptionsByKey - A map where each key is associated with options for generating the fingerprint.
 *   - **Key**: A unique identifier (`string`) for the fingerprint options.
 *   - **Value**: An object containing options for generating a fingerprint.
 *
 * @returns A promise that resolves to a map where each key corresponds to the input keys, and each value is an object containing fingerprint data.
 *
 * @throws Will throw an error if fingerprint computation fails.
 */
export async function createFingerprintsByKeyAsync(
  projectDir: string,
  fingerprintOptionsByKey: Map<
    string,
    { workflow: Workflow; platforms: string[]; debug?: boolean; env: Env | undefined }
  >
): Promise<
  Map<
    string,
    {
      hash: string;
      sources: object[];
      isDebugSource: boolean;
    }
  >
> {
  // @expo/fingerprint is exported in the expo package for SDK 52+
  const fingerprintPath = silentResolveFrom(projectDir, 'expo/fingerprint');
  if (!fingerprintPath) {
    return new Map();
  }

  if (process.env.EAS_SKIP_AUTO_FINGERPRINT) {
    Log.log('Skipping project fingerprints');
    return new Map();
  }

  const timeoutId = setTimeout(() => {
    Log.log('⌛️ Computing the project fingerprints is taking longer than expected...');
    Log.log('⏩ To skip this step, set the environment variable: EAS_SKIP_AUTO_FINGERPRINT=1');
  }, 5000);

  const spinner = ora(`Computing project fingerprints`).start();
  try {
    const fingerprintsByKey = await mapMapAsync(
      fingerprintOptionsByKey,
      async options =>
        await createFingerprintWithoutLoggingAsync(projectDir, fingerprintPath, options)
    );
    spinner.succeed(`Computed project fingerprints`);
    return fingerprintsByKey;
  } catch (e) {
    spinner.fail(`Failed to compute project fingerprints`);
    Log.log('⏩ To skip this step, set the environment variable: EAS_SKIP_AUTO_FINGERPRINT=1');
    throw e;
  } finally {
    // Clear the timeout if the operation finishes before the time limit
    clearTimeout(timeoutId);
    spinner.stop();
  }
}
