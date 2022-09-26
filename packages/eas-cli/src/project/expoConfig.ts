import { ExpoConfig, getConfig } from '@expo/config';
import { Env } from '@expo/eas-build-job';

export interface ExpoConfigOptions {
  env?: Env;
  isPublicConfig?: boolean;
  skipSDKVersionRequirement?: boolean;
}

export function getExpoConfig(projectDir: string, opts: ExpoConfigOptions = {}): ExpoConfig {
  const originalProcessEnv: NodeJS.ProcessEnv = process.env;
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
    process.env = originalProcessEnv;
  }
}
