import type { Env } from '@expo/eas-build-job';

export function resolveSentryUploadEnv(env: Env): Env {
  if (
    env.EAS_BUILD_RUNNER !== 'eas-build' ||
    env.SENTRY_ALLOW_FAILURE ||
    env.SENTRY_DISABLE_AUTO_UPLOAD
  ) {
    return {};
  }

  return { SENTRY_ALLOW_FAILURE: 'true' };
}
