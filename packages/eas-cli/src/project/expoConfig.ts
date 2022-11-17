import { ExpoConfig, getConfig } from '@expo/config';
import { Env } from '@expo/eas-build-job';
import nullthrows from 'nullthrows';

export interface ExpoConfigOptions {
  env?: Env;
  isPublicConfig?: boolean;
  skipSDKVersionRequirement?: boolean;
}

export function getExpoConfig(projectDir: string, opts: ExpoConfigOptions = {}): ExpoConfig {
  const originalProcessEnv: NodeJS.ProcessEnv = process.env;

  const optsEnvKeys = opts.env ? Object.keys(opts.env) : [];
  const originalEnvKeys = new Set(Object.keys(process.env));
  const newKeysAddedToProcessEnv = new Set(optsEnvKeys.filter(k => !originalEnvKeys.has(k)));

  try {
    process.env = {
      ...process.env,
      ...opts.env,
    };
    const { exp } = getConfig(projectDir, {
      skipSDKVersionRequirement: true,
      ...(opts.isPublicConfig ? { isPublicConfig: true } : {}),
    });
    return exp;
  } finally {
    optsEnvKeys.forEach(k => {
      // if new key added, remove unless it was modified
      if (newKeysAddedToProcessEnv.has(k)) {
        if (k in originalProcessEnv) {
          if (process.env[k] === originalProcessEnv[k]) {
            delete process.env[k];
          }
        } else {
          if (nullthrows(opts.env)[k] === process.env[k]) {
            delete process.env[k];
          }
        }
      } else {
        // opts key overrode env key, but only if the value is equal to the one declared by opts
        if (process.env[k] === nullthrows(opts.env)[k]) {
          process.env[k] = originalProcessEnv[k];
        }
      }
    });
  }
}
