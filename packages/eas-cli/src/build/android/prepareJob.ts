import { Android, ArchiveSource, Job, sanitizeJob } from '@expo/eas-build-job';
import path from 'path';

import { AndroidCredentials } from '../../credentials/android/AndroidCredentialsProvider';
import { getUsername } from '../../project/projectUtils';
import { ensureLoggedInAsync } from '../../user/actions';
import vcs from '../../vcs';
import { BuildContext } from '../context';
import { Platform } from '../types';

interface JobData {
  projectArchive: ArchiveSource;
  credentials?: AndroidCredentials;
}

export async function prepareJobAsync(
  ctx: BuildContext<Platform.ANDROID>,
  jobData: JobData
): Promise<Job> {
  const username = getUsername(ctx.commandCtx.exp, await ensureLoggedInAsync());
  const projectRootDirectory =
    path.relative(await vcs.getRootPathAsync(), ctx.commandCtx.projectDir) || '.';
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

  let buildType: Android.BuildType | undefined = ctx.buildProfile.buildType;
  if (!buildType && ctx.buildProfile.distribution === 'internal') {
    buildType = Android.BuildType.APK;
  }

  const job = {
    type: ctx.workflow,
    platform: Platform.ANDROID,
    projectRootDirectory,
    projectArchive: jobData.projectArchive,
    builderEnvironment: {
      image: ctx.buildProfile.image,
      node: ctx.buildProfile.node,
      yarn: ctx.buildProfile.yarn,
      ndk: ctx.buildProfile.ndk,
      expoCli: ctx.buildProfile.expoCli,
      env: ctx.buildProfile.env,
    },
    cache: {
      ...ctx.buildProfile.cache,
      clear: ctx.commandCtx.clearCache,
    },
    secrets: {
      ...buildCredentials,
    },
    releaseChannel: ctx.buildProfile.releaseChannel,
    updates: { channel: ctx.buildProfile.channel },

    gradleCommand: ctx.buildProfile.gradleCommand,
    artifactPath: ctx.buildProfile.artifactPath,

    username,
    buildType,
  };

  return sanitizeJob(job);
}
