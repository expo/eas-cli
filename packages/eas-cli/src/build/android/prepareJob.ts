import { Android, ArchiveSource, Job, Platform, sanitizeJob } from '@expo/eas-build-job';
import { AndroidBuildProfile } from '@expo/eas-json';
import path from 'path';
import slash from 'slash';

import { AndroidCredentials } from '../../credentials/android/AndroidCredentialsProvider';
import { getUsername } from '../../project/projectUtils';
import { ensureLoggedInAsync } from '../../user/actions';
import vcs from '../../vcs';
import { BuildContext } from '../context';

interface JobData {
  projectArchive: ArchiveSource;
  credentials?: AndroidCredentials;
}

const cacheDefaults = {
  disabled: false,
  customPaths: [],
  cacheDefaultPaths: true,
};

export async function prepareJobAsync(
  ctx: BuildContext<Platform.ANDROID>,
  jobData: JobData
): Promise<Job> {
  const username = getUsername(ctx.exp, await ensureLoggedInAsync());
  const buildProfile: AndroidBuildProfile = ctx.buildProfile;
  const projectRootDirectory =
    slash(path.relative(await vcs.getRootPathAsync(), ctx.projectDir)) || '.';
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

  let buildType = ctx.buildProfile.buildType;
  if (!buildType && !buildProfile.gradleCommand && ctx.buildProfile.distribution === 'internal') {
    buildType = Android.BuildType.APK;
  }

  const job: Android.Job = {
    type: ctx.workflow,
    platform: Platform.ANDROID,
    projectRootDirectory,
    projectArchive: jobData.projectArchive,
    builderEnvironment: {
      image: buildProfile.image ?? 'default',
      node: buildProfile.node,
      yarn: buildProfile.yarn,
      ndk: buildProfile.ndk,
      expoCli: buildProfile.expoCli,
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
    releaseChannel: ctx.buildProfile.releaseChannel,
    updates: { channel: ctx.buildProfile.channel },

    gradleCommand: buildProfile.gradleCommand,
    artifactPath: buildProfile.artifactPath,

    username,
    buildType: buildProfile.developmentClient ? Android.BuildType.DEVELOPMENT_CLIENT : buildType,
  };

  return sanitizeJob(job);
}
