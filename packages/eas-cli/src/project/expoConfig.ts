import { ExpoConfig, getConfig } from '@expo/config';
import { Env } from '@expo/eas-build-job';

export function getExpoConfig(projectDir: string, env: Env = {}): ExpoConfig {
  const originalProcessEnv: NodeJS.ProcessEnv = { ...process.env };
  try {
    for (const [key, value] of Object.entries(env)) {
      process.env[key] = value;
    }
    const { exp } = getConfig(projectDir, {
      skipSDKVersionRequirement: true,
      isPublicConfig: true,
    });
    return exp;
  } finally {
    process.env = originalProcessEnv;
  }
}
