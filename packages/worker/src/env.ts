import { RuntimeSettings, getResolvedJobInformationEnv } from '@expo/build-tools';
import { Env, Job, Metadata, Platform } from '@expo/eas-build-job';
import { spawnSync } from 'child_process';
import micromatch from 'micromatch';
import os from 'os';
import path from 'path';

import config from './config';
import { Environment } from './constants';
import { androidImagesWithJavaVersionLowerThen11 } from './external/turtle';
import { getAccessedEnvs } from './utils/env';

// keep in sync with local-build-plugin env vars
// see packages/local-build-plugin/src/build.ts
export function getBuildEnv({
  job,
  projectId,
  metadata,
  buildId,
}: {
  job: Job;
  projectId: string;
  metadata: Metadata;
  buildId: string;
}): Env {
  const env = getFilteredEnv();

  setEnv(env, 'CI', '1');
  // This helps Maestro Simulator test runs time out less.
  // See https://maestro.mobile.dev/advanced/configuring-maestro-driver-timeout and
  // https://github.com/mobile-dev-inc/maestro/issues/1257#issuecomment-1654803779
  setEnv(env, 'MAESTRO_DRIVER_STARTUP_TIMEOUT', '120000');
  setEnv(env, 'MAESTRO_CLI_NO_ANALYTICS', '1');
  setEnv(env, 'EAS_BUILD', 'true');
  setEnv(env, 'EAS_BUILD_RUNNER', 'eas-build');
  setEnv(env, 'EAS_BUILD_PLATFORM', job.platform);
  setEnv(env, 'EAS_CLI_SENTRY_DSN', config.sentry.dsn);
  // NPM_CACHE_URL is deprecated
  const npmCacheUrl = RuntimeSettings.getNpmCacheUrl();
  const nodeJsCacheUrl = RuntimeSettings.getNodeJsCacheUrl();
  const mavenCacheUrl = RuntimeSettings.getMavenCacheUrl();
  const cocoapodsCacheUrl = RuntimeSettings.getCocoapodsCacheUrl();

  setEnv(env, 'NPM_CACHE_URL', npmCacheUrl);
  setEnv(env, 'NPM_CONFIG_REGISTRY', npmCacheUrl);
  setEnv(env, 'NVM_NODEJS_ORG_MIRROR', nodeJsCacheUrl);
  setEnv(env, 'EAS_BUILD_NPM_CACHE_URL', npmCacheUrl);
  setEnv(env, 'EAS_BUILD_ID', buildId);
  setEnv(env, 'LANG', 'en_US.UTF-8');
  setEnv(env, 'EAS_BUILD_WORKINGDIR', path.join(config.workingdir, 'build'));
  setEnv(env, 'EAS_BUILD_PROJECT_ID', projectId);

  const runnerPlatform = job.platform;
  if (runnerPlatform === Platform.IOS) {
    setEnv(env, 'EAS_BUILD_COCOAPODS_CACHE_URL', cocoapodsCacheUrl);
    setEnv(env, 'COMPILER_INDEX_STORE_ENABLE', 'NO');
    if (RuntimeSettings.isUsingIosPrecompiledModulesEnabled()) {
      setEnv(env, 'EAS_USE_PRECOMPILED_MODULES', '1');
    }

    if (job.builderEnvironment?.env?.EAS_USE_CACHE === '1') {
      setEnv(env, 'USE_CCACHE', '1');
      setEnv(env, 'CCACHE_CPP2', '1');

      // Locate ccache binary path if installed, otherwise command will provide a null value
      const ccachePath = spawnSync('command -v ccache', { env, shell: true });
      const binPath = ccachePath.stdout?.toString().trim();
      if (binPath) {
        setEnv(env, 'CCACHE_BINARY', binPath);
      }
    }
  } else if (runnerPlatform === Platform.ANDROID) {
    if (job.builderEnvironment?.env?.EAS_USE_CACHE === '1') {
      const ccachePath = spawnSync('command -v ccache', { env, shell: true });
      const binPath = ccachePath.stdout?.toString().trim();
      if (binPath) {
        setEnv(env, 'ANDROID_CCACHE', binPath);
      }
    }
    setEnv(env, 'EAS_BUILD_MAVEN_CACHE_URL', mavenCacheUrl);
  }

  if (config.env !== Environment.TEST) {
    const { maxHeapSize } = getGradleMemoryOptions();

    setEnv(
      env,
      'GRADLE_OPTS',
      [
        // MaxMetaspaceSize is infinite by default, so we set it to 1g.
        // On web people set it to 256-512m.
        //
        // We need to be careful with Xmx, because the same value will be
        // used for Gradle and Kotlin compiler.
        // https://kotlinlang.org/docs/gradle-compilation-and-caches.html#gradle-daemon-arguments-inheritance
        `-Dorg.gradle.jvmargs="-XX:MaxMetaspaceSize=1g -Xmx${maxHeapSize} ${
          job.builderEnvironment?.image &&
          androidImagesWithJavaVersionLowerThen11.includes(job.builderEnvironment?.image)
            ? '-XX:MaxPermSize=512m '
            : ''
        }-XX:+HeapDumpOnOutOfMemoryError -Dfile.encoding=UTF-8"`,
        // Executes projects in parallel. https://docs.gradle.org/current/userguide/performance.html#parallel_execution
        '-Dorg.gradle.parallel=true',
        // Disable the deamon since it's a one-time run.
        '-Dorg.gradle.daemon=false',
      ].join(' ')
    );
  }

  for (const [key, value] of Object.entries(getResolvedJobInformationEnv(job, metadata))) {
    setEnv(env, key, value);
  }

  if (config.env === Environment.DEVELOPMENT) {
    setEnv(env, 'EXPO_LOCAL', '1');
  } else if (config.env === Environment.STAGING) {
    setEnv(env, 'EXPO_STAGING', '1');
  }

  const xcodeVersionResult = spawnSync('xcodebuild', ['-version'], { env });
  if (xcodeVersionResult.stdout?.includes('Xcode 26.0')) {
    setEnv(env, 'DELIVER_ALTOOL_ADDITIONAL_UPLOAD_PARAMETERS', '--use-old-altool');
  }

  return env;
}

function getFilteredEnv(): Env {
  const envToFilter = [
    ...getAccessedEnvs(),
    'EAS_NPM_CACHE_URL',
    'EAS_NODEJS_CACHE_URL',
    'EAS_MAVEN_CACHE_URL',
    'EAS_COCOAPODS_CACHE_URL',
    'KUBERNETES_*',
  ];
  const envToReturn = micromatch(
    Object.keys(process.env),
    envToFilter.map(env => `!${env}`)
  );
  const result: Env = {};
  for (const key of envToReturn) {
    const value = process.env[key];
    if (value) {
      result[key] = value;
    }
  }
  return result;
}

function setEnv(env: Env, key: string, value: string | null | undefined): void {
  if (value) {
    env[key] = value;
  }
}

export function getGradleMemoryOptions() {
  const totalMemoryGb = os.totalmem() / 1024 / 1024 / 1024;

  return {
    maxHeapSize: `${Math.max(1, Math.round(totalMemoryGb / 4))}g`,
  };
}
