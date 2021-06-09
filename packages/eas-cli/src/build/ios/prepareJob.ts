import { ArchiveSource, Cache, Ios, Job, Workflow, sanitizeJob } from '@expo/eas-build-job';
import { IosGenericBuildProfile, IosManagedBuildProfile } from '@expo/eas-json';
import path from 'path';

import { IosCredentials, TargetCredentials } from '../../credentials/ios/types';
import { getUsername } from '../../project/projectUtils';
import { ensureLoggedInAsync } from '../../user/actions';
import { gitRootDirectoryAsync } from '../../utils/git';
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
  releaseChannel?: string;
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
      image: ctx.buildProfile.image,
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
): Promise<Partial<Ios.GenericJob>> {
  const projectRootDirectory =
    path.relative(await gitRootDirectoryAsync(), ctx.commandCtx.projectDir) || '.';
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
    projectRootDirectory,
  };
}

async function prepareManagedJobAsync(
  ctx: BuildContext<Platform.IOS>,
  jobData: JobData,
  buildProfile: IosManagedBuildProfile
): Promise<Partial<Ios.ManagedJob>> {
  const projectRootDirectory =
    path.relative(await gitRootDirectoryAsync(), ctx.commandCtx.projectDir) || '.';
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
    projectRootDirectory,
  };
}
