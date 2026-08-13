import type { Env } from '@expo/eas-build-job';

export type EnvMode = 'development' | 'production';

/** Set EXPO_CONFIG_MODE and keep NODE_ENV working for older Expo commands. */
export function getExpoCommandEnv(env: Env, mode: EnvMode): Env {
  return {
    ...env,
    NODE_ENV: mode,
    EXPO_CONFIG_MODE: mode,
  };
}
