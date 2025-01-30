import {
  Android,
  ArchiveSource,
  BuildMode,
  BuildTrigger,
  Platform,
  sanitizeBuildJob,
} from '@expo/eas-build-job';
import { BuildProfile } from '@expo/eas-json';
import path from 'path';
import slash from 'slash';

import { AndroidCredentials } from '../../credentials/android/AndroidCredentialsProvider';
import { getCustomBuildConfigPathForJob } from '../../project/customBuildConfig';
import { getUsername } from '../../project/projectUtils';
import { BuildContext } from '../context';

interface JobData {
  projectArchive: ArchiveSource;
  credentials?: AndroidCredentials;
}

const cacheDefaults = {
  disabled: false,
  paths: [],
};

export async function prepareJobAsync(
  ctx: BuildContext<Platform.ANDROID>,
  jobData: JobData
): Promise<Android.Job> {
  const username = getUsername(ctx.exp, ctx.user);
  const buildProfile: BuildProfile<Platform.ANDROID> = ctx.buildProfile;
  const projectRootDirectory =
    slash(path.relative(await ctx.vcsClient.getRootPathAsync(), ctx.projectDir)) || '.';
  const { credentials } = jobData;
  const buildCredentials = credentials
    ? {
        buildCredentials: {
          keystore: {
            dataBase64: credentials.keystore.keystore,
            keystorePassword: credentials.keystore.keystorePassword,
            keyAlias: credentials.keystore.keyAlias,
            keyPassword: credentials.keystore.keyPassword,
          },
        },
      }
    : {};

  let buildType = buildProfile.buildType;
  if (!buildType && !buildProfile.gradleCommand && buildProfile.distribution === 'internal') {
    buildType = Android.BuildType.APK;
  }

  const maybeCustomBuildConfigPath = buildProfile.config
    ? getCustomBuildConfigPathForJob(buildProfile.config)
    : undefined;

  let buildMode;
  if (ctx.repack) {
    buildMode = BuildMode.REPACK;
  } else if (buildProfile.config) {
    buildMode = BuildMode.CUSTOM;
  } else {
    buildMode = BuildMode.BUILD;
  }

  const job: Android.Job = {
    type: ctx.workflow,
    platform: Platform.ANDROID,
    projectRootDirectory,
    projectArchive: jobData.projectArchive,
    builderEnvironment: {
      image: buildProfile.image,
      node: buildProfile.node,
      pnpm: buildProfile.pnpm,
      bun: buildProfile.bun,
      yarn: buildProfile.yarn,
      ndk: buildProfile.ndk,
      env: buildProfile.env,
    },
    cache: {
      ...cacheDefaults,
      ...buildProfile.cache,
      clear: ctx.clearCache,
    },
    secrets: {
      ...buildCredentials,
    },
    updates: { channel: buildProfile.channel },
    developmentClient: buildProfile.developmentClient,
    gradleCommand: buildProfile.gradleCommand,
    applicationArchivePath: buildProfile.applicationArchivePath ?? buildProfile.artifactPath,
    buildArtifactPaths: buildProfile.buildArtifactPaths,
    environment: ctx.buildProfile.environment,
    buildType,
    username,
    ...(ctx.android.versionCodeOverride && {
      version: {
        versionCode: ctx.android.versionCodeOverride,
      },
    }),
    experimental: {
      prebuildCommand: buildProfile.prebuildCommand,
    },
    mode: buildMode,
    triggeredBy: BuildTrigger.EAS_CLI,
    ...(maybeCustomBuildConfigPath && {
      customBuildConfig: {
        path: maybeCustomBuildConfigPath,
      },
    }),
    ...(ctx.repack && {
      customBuildConfig: {
        path: '__eas/repack.yml',
      },
    }),
    loggerLevel: ctx.loggerLevel,
    // Technically, these are unused, but let's include them here for type consistency.
    // See: https://github.com/expo/eas-build/pull/454
    appId: ctx.projectId,
    initiatingUserId: ctx.user.id,
  };

  return sanitizeBuildJob(job) as Android.Job;
}
