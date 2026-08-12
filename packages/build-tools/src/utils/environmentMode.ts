import type { Env } from '@expo/eas-build-job';

const EAS_BUILD_MODE = 'production';

export function getEasBuildEnv(env: Env): Env {
  const result: Env = { ...env, NODE_ENV: EAS_BUILD_MODE };
  delete result.EXPO_CONFIG_MODE;
  return result;
}

export function getExpoCommandEnv(env: Env): Env {
  return {
    ...getEasBuildEnv(env),
    EXPO_CONFIG_MODE: EAS_BUILD_MODE,
  };
}
