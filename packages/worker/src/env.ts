import { Env, Job, Metadata, Platform, Workflow } from '@expo/eas-build-job';
import { spawnSync } from 'child_process';
import micromatch from 'micromatch';
import path from 'path';

import config from './config';
import { Environment } from './constants';
import {
  ResourceClass,
  ResourceClassToPlatform,
  androidImagesWithJavaVersionLowerThen11,
} from './external/turtle';
import { getAccessedEnvs } from './utils/env';

// keep in sync with local-build-plugin env vars
// https://github.com/expo/eas-build/blob/main/packages/local-build-plugin/src/build.ts
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
  // NPM_CACHE_URL is deprecated
  setEnv(env, 'NPM_CACHE_URL', config.npmCacheUrl);
  setEnv(env, 'NVM_NODEJS_ORG_MIRROR', config.nodeJsCacheUrl);
  setEnv(env, 'EAS_BUILD_NPM_CACHE_URL', config.npmCacheUrl);
  setEnv(env, 'EAS_BUILD_PROFILE', metadata.buildProfile);
  setEnv(env, 'EAS_BUILD_GIT_COMMIT_HASH', metadata.gitCommitHash);
  setEnv(env, 'EAS_BUILD_ID', buildId);
  setEnv(env, 'LANG', 'en_US.UTF-8');
  setEnv(env, 'EAS_BUILD_WORKINGDIR', path.join(config.workingdir, 'build'));
  setEnv(env, 'EAS_BUILD_PROJECT_ID', projectId);

  const runnerPlatform =
    job.platform ?? (config.resourceClass && ResourceClassToPlatform[config.resourceClass]);
  if (runnerPlatform === Platform.IOS) {
    setEnv(env, 'EAS_BUILD_COCOAPODS_CACHE_URL', config.cocoapodsCacheUrl);
    setEnv(env, 'COMPILER_INDEX_STORE_ENABLE', 'NO');

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
    setEnv(env, 'EAS_BUILD_MAVEN_CACHE_URL', config.mavenCacheUrl);
  }

  if (config.env !== Environment.TEST) {
    const maxHeapSize = config.resourceClass
      ? ResourceClassToMaxHeapSize[config.resourceClass] ?? '4g'
      : '4g';

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

  if (job.platform === Platform.ANDROID) {
    if (job.version?.versionCode) {
      setEnv(env, 'EAS_BUILD_ANDROID_VERSION_CODE', job.version.versionCode);
    }
    if (job.version?.versionName) {
      setEnv(env, 'EAS_BUILD_ANDROID_VERSION_NAME', job.version.versionName);
    }
  } else if (job.platform === Platform.IOS) {
    if (job.version?.buildNumber) {
      setEnv(env, 'EAS_BUILD_IOS_BUILD_NUMBER', job.version.buildNumber);
    }
    if (job.version?.appVersion) {
      setEnv(env, 'EAS_BUILD_IOS_APP_VERSION', job.version.appVersion);
    }
  }

  let username = metadata.username;
  if (!username && 'type' in job && job.type === Workflow.MANAGED) {
    username = job.username;
  }
  setEnv(env, 'EAS_BUILD_USERNAME', username);

  if (config.env === Environment.DEVELOPMENT) {
    setEnv(env, 'EXPO_LOCAL', '1');
  } else if (config.env === Environment.STAGING) {
    setEnv(env, 'EXPO_STAGING', '1');
  }

  return env;
}

function getFilteredEnv(): Env {
  const envToFilter = [...getAccessedEnvs(), 'KUBERNETES_*'];
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

const ResourceClassToMaxHeapSize: Record<ResourceClass, string | null> = {
  [ResourceClass.LINUX_C3D_STANDARD_4]: '4g', // 4 out of 16 GB, 12 GB left
  [ResourceClass.LINUX_C3D_STANDARD_8]: '8g', // 8 out of 32 GB, 24 GB left
  [ResourceClass.LINUX_C4D_STANDARD_4]: '4g', // 4 out of 15 GB, 11 GB left
  [ResourceClass.LINUX_C4D_STANDARD_8]: '8g', // 8 out of 31 GB, 23 GB left
  [ResourceClass.ANDROID_N2_1_3_12]: '4g', // 4 out of 12 GB, 8 GB left
  [ResourceClass.ANDROID_N2_2_6_24]: '8g', // 8 out of 24 GB, 16 GB left

  // We don't care about Gradle heap size for macOS resource classes
  [ResourceClass.IOS_M1_4_16]: null,
  [ResourceClass.IOS_M2_2_8]: null,
  [ResourceClass.IOS_M2_PRO_4_12]: null,
  [ResourceClass.IOS_M4_PRO_5_20]: null,
  [ResourceClass.IOS_M4_PRO_10_40]: null,
  [ResourceClass.IOS_M2_4_22]: null,
};
