import { Android, ArchiveSource, Cache, Job, Workflow, sanitizeJob } from '@expo/eas-build-job';
import { AndroidGenericBuildProfile, AndroidManagedBuildProfile } from '@expo/eas-json';
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
  if (ctx.buildProfile.workflow === Workflow.GENERIC) {
    const partialJob = await prepareGenericJobAsync(ctx, jobData, ctx.buildProfile);
    return sanitizeJob(partialJob);
  } else if (ctx.buildProfile.workflow === Workflow.MANAGED) {
    const partialJob = await prepareManagedJobAsync(ctx, jobData, ctx.buildProfile);
    return sanitizeJob(partialJob);
  } else {
    throw new Error("Unknown workflow. Shouldn't happen");
  }
}

interface CommonJobProperties {
  platform: Platform.ANDROID;
  projectArchive: ArchiveSource;
  builderEnvironment: Android.BuilderEnvironment;
  cache: Cache;
  secrets: {
    buildCredentials?: {
      keystore: Android.Keystore;
    };
  };
}

async function prepareJobCommonAsync(
  ctx: BuildContext<Platform.ANDROID>,
  jobData: JobData
): Promise<Partial<CommonJobProperties>> {
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

  return {
    platform: Platform.ANDROID,
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
  };
}

async function prepareGenericJobAsync(
  ctx: BuildContext<Platform.ANDROID>,
  jobData: JobData,
  buildProfile: AndroidGenericBuildProfile
): Promise<Partial<Android.Job>> {
  const projectRootDirectory =
    path.relative(await vcs.getRootPathAsync(), ctx.commandCtx.projectDir) || '.';
  return {
    ...(await prepareJobCommonAsync(ctx, jobData)),
    type: Workflow.GENERIC,
    gradleCommand: buildProfile.gradleCommand,
    artifactPath: buildProfile.artifactPath,
    releaseChannel: buildProfile.releaseChannel,
    updates: { channel: buildProfile.channel },
    projectRootDirectory,
  };
}

async function prepareManagedJobAsync(
  ctx: BuildContext<Platform.ANDROID>,
  jobData: JobData,
  buildProfile: AndroidManagedBuildProfile
): Promise<Partial<Android.Job>> {
  const projectRootDirectory =
    path.relative(await vcs.getRootPathAsync(), ctx.commandCtx.projectDir) || '.';
  const username = getUsername(ctx.commandCtx.exp, await ensureLoggedInAsync());
  return {
    ...(await prepareJobCommonAsync(ctx, jobData)),
    type: Workflow.MANAGED,
    username,
    buildType: buildProfile.buildType,
    releaseChannel: buildProfile.releaseChannel,
    updates: { channel: buildProfile.channel },
    projectRootDirectory,
  };
}
