import { Android, ArchiveSource, Job, Platform, sanitizeJob } from '@expo/eas-build-job';
import { BuildProfile } from '@expo/eas-json';
import path from 'path';
import slash from 'slash';

import { AndroidCredentials } from '../../credentials/android/AndroidCredentialsProvider';
import { getUsername } from '../../project/projectUtils';
import { ensureLoggedInAsync } from '../../user/actions';
import { getVcsClient } from '../../vcs';
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
  const buildProfile: BuildProfile<Platform.ANDROID> = ctx.buildProfile;
  const projectRootDirectory =
    slash(path.relative(await getVcsClient().getRootPathAsync(), ctx.projectDir)) || '.';
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
      image: buildProfile.image,
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
    developmentClient: buildProfile.developmentClient,
    gradleCommand: buildProfile.gradleCommand,
    artifactPath: buildProfile.artifactPath,
    buildType,
    username,
    experimental: {
      prebuildCommand: ctx.buildProfile.prebuildCommand,
    },
  };

  return sanitizeJob(job);
}
