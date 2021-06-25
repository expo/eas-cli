import { ArchiveSource, Cache, Ios, Job, Workflow, sanitizeJob } from '@expo/eas-build-job';
import { IosGenericBuildProfile, IosManagedBuildProfile } from '@expo/eas-json';
import path from 'path';
import semver from 'semver';

import { IosCredentials, TargetCredentials } from '../../credentials/ios/types';
import { getUsername } from '../../project/projectUtils';
import { ensureLoggedInAsync } from '../../user/actions';
import vcs from '../../vcs';
import { BuildContext } from '../context';
import { Platform } from '../types';

interface JobData {
  projectArchive: ArchiveSource;
  credentials?: IosCredentials;
  buildScheme: string;
}

export async function prepareJobAsync(
  ctx: BuildContext<Platform.IOS>,
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
  platform: Platform.IOS;
  projectArchive: ArchiveSource;
  builderEnvironment: Ios.BuilderEnvironment;
  distribution?: Ios.DistributionType;
  cache: Cache;
  secrets: {
    buildCredentials: Ios.BuildCredentials;
    environmentSecrets?: Record<string, string>;
  };
}

async function prepareJobCommonAsync(
  ctx: BuildContext<Platform.IOS>,
  { credentials, projectArchive }: { credentials?: IosCredentials; projectArchive: ArchiveSource }
): Promise<Partial<CommonJobProperties>> {
  const buildCredentials: CommonJobProperties['secrets']['buildCredentials'] = {};
  if (credentials) {
    const targetNames = Object.keys(credentials);
    for (const targetName of targetNames) {
      buildCredentials[targetName] = prepareTargetCredentials(credentials[targetName]);
    }
  }

  return {
    platform: Platform.IOS,
    projectArchive,
    distribution: ctx.buildProfile.distribution,
    builderEnvironment: {
      image: resolveImage(ctx),
      node: ctx.buildProfile.node,
      yarn: ctx.buildProfile.yarn,
      bundler: ctx.buildProfile.bundler,
      cocoapods: ctx.buildProfile.cocoapods,
      fastlane: ctx.buildProfile.fastlane,
      expoCli: ctx.buildProfile.expoCli,
      env: ctx.buildProfile.env,
    },
    cache: {
      ...ctx.buildProfile.cache,
      clear: ctx.commandCtx.clearCache,
    },
    secrets: {
      buildCredentials,
    },
  };
}

function resolveImage(ctx: BuildContext<Platform.IOS>): Ios.BuilderEnvironment['image'] {
  // see https://linear.app/expo/issue/ENG-1396/make-default-image-dependent-on-sdk-version
  if (!ctx.buildProfile.image && ctx.commandCtx.exp.sdkVersion) {
    const majorSdkVersion = semver.major(ctx.commandCtx.exp.sdkVersion);
    if (majorSdkVersion <= 41) {
      return 'macos-catalina-10.15-xcode-12.4';
    }
  }
  return ctx.buildProfile.image ?? 'default';
}

function prepareTargetCredentials(targetCredentials: TargetCredentials): Ios.TargetCredentials {
  return {
    provisioningProfileBase64: targetCredentials.provisioningProfile,
    distributionCertificate: {
      dataBase64: targetCredentials.distributionCertificate.certificateP12,
      password: targetCredentials.distributionCertificate.certificatePassword,
    },
  };
}

async function prepareGenericJobAsync(
  ctx: BuildContext<Platform.IOS>,
  jobData: JobData,
  buildProfile: IosGenericBuildProfile
): Promise<Partial<Ios.Job>> {
  const projectRootDirectory =
    path.relative(await vcs.getRootPathAsync(), ctx.commandCtx.projectDir) || '.';
  return {
    ...(await prepareJobCommonAsync(ctx, {
      credentials: jobData.credentials,
      projectArchive: jobData.projectArchive,
    })),
    type: Workflow.GENERIC,
    scheme: jobData.buildScheme,
    buildConfiguration: buildProfile.schemeBuildConfiguration,
    artifactPath: buildProfile.artifactPath,
    releaseChannel: buildProfile.releaseChannel,
    updates: { channel: buildProfile.channel },
    projectRootDirectory,
  };
}

async function prepareManagedJobAsync(
  ctx: BuildContext<Platform.IOS>,
  jobData: JobData,
  buildProfile: IosManagedBuildProfile
): Promise<Partial<Ios.Job>> {
  const projectRootDirectory =
    path.relative(await vcs.getRootPathAsync(), ctx.commandCtx.projectDir) || '.';
  const username = getUsername(ctx.commandCtx.exp, await ensureLoggedInAsync());
  return {
    ...(await prepareJobCommonAsync(ctx, {
      credentials: jobData.credentials,
      projectArchive: jobData.projectArchive,
    })),
    type: Workflow.MANAGED,
    buildType: buildProfile.buildType,
    username,
    releaseChannel: buildProfile.releaseChannel,
    updates: { channel: buildProfile.channel },
    projectRootDirectory,
  };
}
