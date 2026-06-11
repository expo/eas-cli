import { Android, BuildPhase, BuildPhaseResult } from '@expo/eas-build-job';
import { vol } from 'memfs';

import { createTestAndroidJob } from '../../__tests__/utils/job';
import { createMockLogger } from '../../__tests__/utils/logger';
import { BuildContext } from '../../context';
import { Datadog } from '../../datadog';
import { restoreCredentials } from '../../android/credentials';
import { uploadEmbeddedBundleAsync } from '../../utils/expoUpdatesEmbedded';
import androidBuilder from '../android';
import { runBuilderWithHooksAsync } from '../common';
import {
  injectConfigureVersionGradleConfig,
  injectCredentialsGradleConfig,
} from '../../steps/utils/android/gradleConfig';
import {
  logGradleCacheEnv,
  restoreGradleCacheAsync,
} from '../../steps/functions/restoreBuildCache';

jest.mock('../common', () => ({
  runBuilderWithHooksAsync: jest.fn(async (ctx, buildFn) => {
    await buildFn(ctx);
    return ctx.artifacts;
  }),
}));
jest.mock('../custom', () => ({
  runCustomBuildAsync: jest.fn(),
}));
jest.mock('../../android/credentials');
jest.mock('../../android/gradle', () => ({
  ensureLFLineEndingsInGradlewScript: jest.fn(),
  resolveGradleCommand: jest.fn(() => ':app:bundleRelease'),
  runGradleCommand: jest.fn(),
}));
jest.mock('../../common/eagerBundle', () => ({
  eagerBundleAsync: jest.fn(),
  shouldUseEagerBundle: jest.fn(() => false),
}));
jest.mock('../../common/prebuild', () => ({
  prebuildAsync: jest.fn(),
}));
jest.mock('../../common/setup', () => ({
  setupAsync: jest.fn(),
}));
jest.mock('../../steps/functions/restoreBuildCache', () => ({
  cacheStatsAsync: jest.fn(),
  logGradleCacheEnv: jest.fn(),
  restoreCcacheAsync: jest.fn(),
  restoreGradleCacheAsync: jest.fn(async () => ({ env: {} })),
}));
jest.mock('../../steps/functions/saveBuildCache', () => ({
  saveCcacheAsync: jest.fn(),
  saveGradleCacheAsync: jest.fn(),
}));
jest.mock('../../steps/utils/android/gradleConfig', () => ({
  ...jest.requireActual('../../steps/utils/android/gradleConfig'),
  injectConfigureVersionGradleConfig: jest.fn(),
  injectCredentialsGradleConfig: jest.fn(),
}));
jest.mock('../../utils/artifacts', () => ({
  uploadApplicationArchive: jest.fn(),
}));
jest.mock('../../utils/expoUpdates', () => ({
  configureExpoUpdatesIfInstalledAsync: jest.fn(),
  resolveRuntimeVersionForExpoUpdatesIfConfiguredAsync: jest.fn(async () => null),
}));
jest.mock('../../utils/expoUpdatesEmbedded', () => ({
  uploadEmbeddedBundleAsync: jest.fn(),
}));
jest.mock('../../utils/hooks', () => ({
  Hook: {
    POST_INSTALL: 'POST_INSTALL',
    PRE_UPLOAD_ARTIFACTS: 'PRE_UPLOAD_ARTIFACTS',
  },
  runHookIfPresent: jest.fn(),
}));
jest.mock('../../utils/prepareBuildExecutable', () => ({
  prepareExecutableAsync: jest.fn(),
}));

const datadogDistributionMock = jest.spyOn(Datadog, 'distribution');

describe(androidBuilder, () => {
  beforeEach(() => {
    jest.clearAllMocks();
    vol.fromJSON(
      {
        '/workingdir/env/.gitkeep': '',
        '/workingdir/build/package.json': JSON.stringify({
          name: 'test-app',
          version: '1.0.0',
        }),
      },
      '/'
    );
  });

  it('injects Android version config without build credentials', async () => {
    const job: Android.Job = {
      ...createTestAndroidJob(),
      secrets: {
        buildCredentials: undefined,
      },
      version: {
        versionCode: '42',
        versionName: '1.2.3',
      },
    };
    const ctx = new BuildContext(job, {
      workingdir: '/workingdir',
      logBuffer: { getLogs: () => [], getPhaseLogs: () => [] },
      logger: createMockLogger(),
      env: {
        __API_SERVER_URL: 'http://api.expo.test',
      },
      uploadArtifact: jest.fn(),
    });

    await androidBuilder(ctx);

    expect(injectConfigureVersionGradleConfig).toHaveBeenCalledWith(
      expect.anything(),
      '/workingdir/build',
      {
        versionCode: '42',
        versionName: '1.2.3',
      }
    );
    expect(injectCredentialsGradleConfig).not.toHaveBeenCalled();
    expect(restoreCredentials).not.toHaveBeenCalled();
  });

  it('injects Android credentials config when build credentials are present', async () => {
    const ctx = new BuildContext(createTestAndroidJob(), {
      workingdir: '/workingdir',
      logBuffer: { getLogs: () => [], getPhaseLogs: () => [] },
      logger: createMockLogger(),
      env: {
        EAS_BUILD_RUNNER: 'eas-build',
        __API_SERVER_URL: 'http://api.expo.test',
      },
      uploadArtifact: jest.fn(),
    });

    await androidBuilder(ctx);

    expect(injectCredentialsGradleConfig).toHaveBeenCalledWith(
      expect.anything(),
      '/workingdir/build'
    );
    expect(restoreCredentials).toHaveBeenCalledWith(ctx);
    expect(injectConfigureVersionGradleConfig).not.toHaveBeenCalled();
  });

  it('logs Gradle cache environment variables returned by restoreGradleCacheAsync', async () => {
    jest.mocked(restoreGradleCacheAsync).mockResolvedValueOnce({
      env: {
        'ORG_GRADLE_PROJECT_org.gradle.caching': 'true',
      },
    });
    const ctx = new BuildContext(createTestAndroidJob(), {
      workingdir: '/workingdir',
      logBuffer: { getLogs: () => [], getPhaseLogs: () => [] },
      logger: createMockLogger(),
      env: {
        EAS_BUILD_RUNNER: 'eas-build',
        __API_SERVER_URL: 'http://api.expo.test',
      },
      uploadArtifact: jest.fn(),
    });

    await androidBuilder(ctx);

    expect(logGradleCacheEnv).toHaveBeenCalledWith(expect.anything(), {
      'ORG_GRADLE_PROJECT_org.gradle.caching': 'true',
    });
  });

  it('marks the configure Android version phase as warning for legacy eas-build.gradle', async () => {
    const job: Android.Job = {
      ...createTestAndroidJob(),
      secrets: {
        buildCredentials: undefined,
      },
      version: {
        versionCode: '42',
        versionName: '1.2.3',
      },
    };
    const ctx = new BuildContext(job, {
      workingdir: '/workingdir',
      logBuffer: { getLogs: () => [], getPhaseLogs: () => [] },
      logger: createMockLogger(),
      env: {
        __API_SERVER_URL: 'http://api.expo.test',
      },
      uploadArtifact: jest.fn(),
    });
    vol.mkdirSync('/workingdir/build/android/app', { recursive: true });
    vol.writeFileSync('/workingdir/build/android/app/eas-build.gradle', '// Legacy content');

    await androidBuilder(ctx);

    expect(datadogDistributionMock).toHaveBeenCalledWith(
      'eas.build.phase_duration',
      expect.any(Number),
      expect.objectContaining({
        build_phase: BuildPhase.CONFIGURE_ANDROID_VERSION.toLowerCase(),
        result: BuildPhaseResult.WARNING,
      })
    );
  });

  it('marks the prepare credentials phase as warning for legacy eas-build.gradle', async () => {
    const ctx = new BuildContext(createTestAndroidJob(), {
      workingdir: '/workingdir',
      logBuffer: { getLogs: () => [], getPhaseLogs: () => [] },
      logger: createMockLogger(),
      env: {
        __API_SERVER_URL: 'http://api.expo.test',
      },
      uploadArtifact: jest.fn(),
    });
    vol.mkdirSync('/workingdir/build/android/app', { recursive: true });
    vol.writeFileSync('/workingdir/build/android/app/eas-build.gradle', '// Legacy content');

    await androidBuilder(ctx);

    expect(datadogDistributionMock).toHaveBeenCalledWith(
      'eas.build.phase_duration',
      expect.any(Number),
      expect.objectContaining({
        build_phase: BuildPhase.PREPARE_CREDENTIALS.toLowerCase(),
        result: BuildPhaseResult.WARNING,
      })
    );
  });

  it('injects credentials and version config when both are configured', async () => {
    const job: Android.Job = {
      ...createTestAndroidJob(),
      version: {
        versionCode: '42',
        versionName: '1.2.3',
      },
    };
    const ctx = new BuildContext(job, {
      workingdir: '/workingdir',
      logBuffer: { getLogs: () => [], getPhaseLogs: () => [] },
      logger: createMockLogger(),
      env: {
        __API_SERVER_URL: 'http://api.expo.test',
      },
      uploadArtifact: jest.fn(),
    });
    vol.mkdirSync('/workingdir/build/android/app', { recursive: true });
    vol.writeFileSync('/workingdir/build/android/app/eas-build.gradle', '// Legacy content');

    await androidBuilder(ctx);

    expect(injectCredentialsGradleConfig).toHaveBeenCalledWith(
      expect.anything(),
      '/workingdir/build'
    );
    expect(restoreCredentials).toHaveBeenCalledWith(ctx);
    expect(injectConfigureVersionGradleConfig).toHaveBeenCalledWith(
      expect.anything(),
      '/workingdir/build',
      {
        versionCode: '42',
        versionName: '1.2.3',
      }
    );
    expect(datadogDistributionMock).toHaveBeenCalledWith(
      'eas.build.phase_duration',
      expect.any(Number),
      expect.objectContaining({
        build_phase: BuildPhase.PREPARE_CREDENTIALS.toLowerCase(),
        result: BuildPhaseResult.WARNING,
      })
    );
    expect(datadogDistributionMock).toHaveBeenCalledWith(
      'eas.build.phase_duration',
      expect.any(Number),
      expect.objectContaining({
        build_phase: BuildPhase.CONFIGURE_ANDROID_VERSION.toLowerCase(),
        result: BuildPhaseResult.WARNING,
      })
    );
  });

  it('runs the builder through hooks', async () => {
    const ctx = new BuildContext(createTestAndroidJob(), {
      workingdir: '/workingdir',
      logBuffer: { getLogs: () => [], getPhaseLogs: () => [] },
      logger: createMockLogger(),
      env: {
        __API_SERVER_URL: 'http://api.expo.test',
      },
      uploadArtifact: jest.fn(),
    });

    await androidBuilder(ctx);

    expect(runBuilderWithHooksAsync).toHaveBeenCalledWith(ctx, expect.any(Function));
  });

  it('runs the embedded bundle upload phase when EAS_UPDATE_EXPERIMENTAL_UPLOAD_EMBEDDED_BUNDLE is set', async () => {
    const ctx = new BuildContext(createTestAndroidJob(), {
      workingdir: '/workingdir',
      logBuffer: { getLogs: () => [], getPhaseLogs: () => [] },
      logger: createMockLogger(),
      env: {
        __API_SERVER_URL: 'http://api.expo.test',
        EAS_UPDATE_EXPERIMENTAL_UPLOAD_EMBEDDED_BUNDLE: '1',
      },
      uploadArtifact: jest.fn(),
    });

    await androidBuilder(ctx);

    expect(uploadEmbeddedBundleAsync).toHaveBeenCalledWith(ctx);
  });

  it('skips the embedded bundle upload phase when EAS_UPDATE_EXPERIMENTAL_UPLOAD_EMBEDDED_BUNDLE is not set', async () => {
    const ctx = new BuildContext(createTestAndroidJob(), {
      workingdir: '/workingdir',
      logBuffer: { getLogs: () => [], getPhaseLogs: () => [] },
      logger: createMockLogger(),
      env: {
        __API_SERVER_URL: 'http://api.expo.test',
      },
      uploadArtifact: jest.fn(),
    });

    await androidBuilder(ctx);

    expect(uploadEmbeddedBundleAsync).not.toHaveBeenCalled();
  });
});
