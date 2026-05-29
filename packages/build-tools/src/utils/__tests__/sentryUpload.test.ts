import { resolveSentryUploadEnv } from '../sentryUpload';

describe(resolveSentryUploadEnv, () => {
  it('allows Sentry upload failures by default', () => {
    expect(resolveSentryUploadEnv({ EAS_BUILD_RUNNER: 'eas-build' })).toEqual({
      SENTRY_ALLOW_FAILURE: 'true',
    });
  });

  it('does not change Sentry upload behavior outside hosted EAS Build', () => {
    expect(resolveSentryUploadEnv({})).toEqual({});
  });

  it('preserves explicit Sentry upload behavior', () => {
    expect(
      resolveSentryUploadEnv({ EAS_BUILD_RUNNER: 'eas-build', SENTRY_ALLOW_FAILURE: 'false' })
    ).toEqual({});
    expect(
      resolveSentryUploadEnv({ EAS_BUILD_RUNNER: 'eas-build', SENTRY_DISABLE_AUTO_UPLOAD: 'true' })
    ).toEqual({});
  });

});
