import { Env, Workflow } from '@expo/eas-build-job';
import { silent as silentResolveFrom } from 'resolve-from';

import { Fingerprint, FingerprintDiffItem } from './types';
import Log from '../log';
import { ora } from '../ora';
import { getEnvWithoutInheritedDotenvValues } from '../utils/originalEnv';

export type FingerprintOptions = {
  workflow?: Workflow;
  platforms: string[];
  debug?: boolean;
  env: Env | undefined;
  cwd?: string;
  ignorePaths?: string[];
};

export function diffFingerprint(
  projectDir: string,
  fingerprint1: Fingerprint,
  fingerprint2: Fingerprint
): FingerprintDiffItem[] | null {
  // @expo/fingerprint is exported in the expo package for SDK 52+
  const fingerprintPath = silentResolveFrom(projectDir, 'expo/fingerprint');
  if (!fingerprintPath) {
    return null;
  }

  const Fingerprint = require(fingerprintPath);
  return Fingerprint.diffFingerprints(fingerprint1, fingerprint2);
}

export async function createFingerprintAsync(
  projectDir: string,
  options: FingerprintOptions
): Promise<
  | (Fingerprint & {
      isDebugSource: boolean;
    })
  | null
> {
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
  options: FingerprintOptions
): Promise<
  Fingerprint & {
    isDebugSource: boolean;
  }
> {
  return await withTemporaryEnvAsync(options.env ?? {}, () =>
    createFingerprintWithCurrentEnvAsync(projectDir, fingerprintPath, options)
  );
}

async function createFingerprintWithCurrentEnvAsync(
  projectDir: string,
  fingerprintPath: string,
  options: FingerprintOptions
): Promise<
  Fingerprint & {
    isDebugSource: boolean;
  }
> {
  const Fingerprint = require(fingerprintPath);
  const fingerprintOptions: Record<string, any> = {};
  const ignorePaths = [];
  if (options.workflow === Workflow.MANAGED) {
    ignorePaths.push('android/**/*');
    ignorePaths.push('ios/**/*');
  }
  if (options.ignorePaths) {
    ignorePaths.push(...options.ignorePaths);
  }
  if (ignorePaths.length > 0) {
    fingerprintOptions.ignorePaths = ignorePaths;
  }
  if (options.platforms) {
    fingerprintOptions.platforms = [...options.platforms];
  }
  if (options.debug) {
    fingerprintOptions.debug = true;
  }
  fingerprintOptions.silent = true;

  return await Fingerprint.createFingerprintAsync(projectDir, fingerprintOptions);
}

async function withTemporaryEnvAsync<T>(envVars: Env, fn: () => Promise<T>): Promise<T> {
  const originalEnv = process.env;
  process.env = {
    ...getEnvWithoutInheritedDotenvValues(process.env),
    ...envVars,
    NODE_ENV: 'development',
  };
  delete process.env.__EXPO_ENV_LOADED;
  delete process.env.__EXPO_CONFIG_MODE;

  try {
    return await fn();
  } finally {
    process.env = originalEnv;
  }
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
  fingerprintOptionsByKey: Map<string, FingerprintOptions>
): Promise<
  Map<
    string,
    Fingerprint & {
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
    // Fingerprint reads process.env, so only calls that use the same env can run together.
    const fingerprintOptionsByEnv = new Map<Env | undefined, [string, FingerprintOptions][]>();
    for (const entry of fingerprintOptionsByKey.entries()) {
      const env = entry[1].env;
      const entries = fingerprintOptionsByEnv.get(env) ?? [];
      entries.push(entry);
      fingerprintOptionsByEnv.set(env, entries);
    }

    const fingerprintsByKey = new Map<
      string,
      Fingerprint & {
        isDebugSource: boolean;
      }
    >();
    for (const [env, entries] of fingerprintOptionsByEnv) {
      const fingerprints = await withTemporaryEnvAsync(env ?? {}, async () => {
        const fingerprintPromises = entries.map(
          async ([key, options]) =>
            [
              key,
              await createFingerprintWithCurrentEnvAsync(projectDir, fingerprintPath, options),
            ] as const
        );
        try {
          return await Promise.all(fingerprintPromises);
        } catch (error) {
          await Promise.allSettled(fingerprintPromises);
          throw error;
        }
      });
      for (const [key, fingerprint] of fingerprints) {
        fingerprintsByKey.set(key, fingerprint);
      }
    }
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
