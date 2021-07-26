import { ExpoConfig, getConfig } from '@expo/config';
import { Env } from '@expo/eas-build-job';

export function getExpoConfig(projectDir: string, env: Env = {}): ExpoConfig {
  const originalProcessEnv: NodeJS.ProcessEnv = process.env;
  try {
    process.env = {
      ...process.env,
      ...env,
    };
    const { exp } = getConfig(projectDir, {
      skipSDKVersionRequirement: true,
    });
    return exp;
  } finally {
    process.env = originalProcessEnv;
  }
}
