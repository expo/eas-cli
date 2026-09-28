import type { Env } from '@expo/eas-build-job';

export type EnvMode = 'development' | 'production';

/** Set `__EXPO_CONFIG_MODE` and `NODE_ENV` because older Expo CLI versions only read `NODE_ENV`. */
export function getExpoCommandEnv(env: Env, mode: EnvMode): Env {
  return {
    ...env,
    NODE_ENV: mode,
    __EXPO_CONFIG_MODE: mode,
  };
}
