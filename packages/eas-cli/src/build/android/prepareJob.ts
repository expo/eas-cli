import {
  Android,
  ArchiveSource,
  ArchiveSourceType,
  Cache,
  Job,
  Workflow,
  sanitizeJob,
} from '@expo/eas-build-job';
import { AndroidGenericBuildProfile, AndroidManagedBuildProfile } from '@expo/eas-json';
import path from 'path';

import { AndroidCredentials } from '../../credentials/android/AndroidCredentialsProvider';
import { readSecretEnvsAsync } from '../../credentials/credentialsJson/read';
import { getProjectAccountNameAsync } from '../../project/projectUtils';
import { gitRootDirectoryAsync } from '../../utils/git';
import { BuildContext } from '../context';
import { Platform } from '../types';

interface JobData {
  archiveBucketKey: string;
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
    secretEnvs?: Record<string, string>;
  };
}

async function prepareJobCommonAsync(
  ctx: BuildContext<Platform.ANDROID>,
  jobData: JobData
): Promise<Partial<CommonJobProperties>> {
  const secretEnvs = await readSecretEnvsAsync(ctx.commandCtx.projectDir);
  const credentials = jobData.credentials;
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
    projectArchive: {
      type: ArchiveSourceType.S3,
      bucketKey: jobData.archiveBucketKey,
    },
    builderEnvironment: {
      image: ctx.buildProfile.image,
      node: ctx.buildProfile.node,
      yarn: ctx.buildProfile.yarn,
      ndk: ctx.buildProfile.ndk,
      env: ctx.buildProfile.env,
    },
    cache: ctx.buildProfile.cache,
    secrets: {
      ...(secretEnvs ? { secretEnvs } : {}),
      ...buildCredentials,
    },
  };
}

async function prepareGenericJobAsync(
  ctx: BuildContext<Platform.ANDROID>,
  jobData: JobData,
  buildProfile: AndroidGenericBuildProfile
): Promise<Partial<Android.GenericJob>> {
  const projectRootDirectory =
    path.relative(await gitRootDirectoryAsync(), ctx.commandCtx.projectDir) || '.';
  return {
    ...(await prepareJobCommonAsync(ctx, jobData)),
    type: Workflow.GENERIC,
    gradleCommand: buildProfile.gradleCommand,
    artifactPath: buildProfile.artifactPath,
    releaseChannel: buildProfile.releaseChannel,
    projectRootDirectory,
  };
}

async function prepareManagedJobAsync(
  ctx: BuildContext<Platform.ANDROID>,
  jobData: JobData,
  buildProfile: AndroidManagedBuildProfile
): Promise<Partial<Android.ManagedJob>> {
  const projectRootDirectory =
    path.relative(await gitRootDirectoryAsync(), ctx.commandCtx.projectDir) || '.';
  const accountName = await getProjectAccountNameAsync(ctx.commandCtx.exp);
  return {
    ...(await prepareJobCommonAsync(ctx, jobData)),
    type: Workflow.MANAGED,
    username: accountName,
    buildType: buildProfile.buildType,
    releaseChannel: buildProfile.releaseChannel,
    projectRootDirectory,
  };
}
