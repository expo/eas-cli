import { ExpoConfig, getConfig } from '@expo/config';
import { Env } from '@expo/eas-build-job';

interface Options {
  env?: Env;
  isPublicConfig?: boolean;
}

export function getExpoConfig(projectDir: string, opts: Options = {}): ExpoConfig {
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
