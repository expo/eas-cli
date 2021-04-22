import { ArchiveSource, Cache, Ios, Job, Workflow, sanitizeJob } from '@expo/eas-build-job';
import { IosGenericBuildProfile, IosManagedBuildProfile } from '@expo/eas-json';
import assert from 'assert';
import path from 'path';

import {
  IosCredentials,
  IosTargetCredentials,
  isCredentialsMap,
  readEnvironmentSecretsAsync,
} from '../../credentials/credentialsJson/read';
import { getUsername } from '../../project/projectUtils';
import { ensureLoggedInAsync } from '../../user/actions';
import { gitRootDirectoryAsync } from '../../utils/git';
import { BuildContext } from '../context';
import { Platform } from '../types';

interface JobData {
  projectArchive: ArchiveSource;
  credentials?: IosCredentials;
  projectConfiguration: {
    iosBuildScheme?: string;
    iosApplicationTarget?: string;
  };
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
  {
    credentials,
    targetName,
    projectArchive,
  }: { credentials?: IosCredentials; targetName?: string; projectArchive: ArchiveSource }
): Promise<Partial<CommonJobProperties>> {
  const environmentSecrets = await readEnvironmentSecretsAsync(ctx.commandCtx.projectDir);

  let buildCredentials: CommonJobProperties['secrets']['buildCredentials'] = {};
  if (credentials && isCredentialsMap(credentials)) {
    const targets = Object.keys(credentials);
    for (const target of targets) {
      buildCredentials[target] = prepareTargetCredentials(credentials[target]);
    }
  } else if (credentials) {
    // targetName
    // - for managed projects: sanitized .name from the app config
    // - for generic projects: name of the application target
    assert(targetName, 'target name should be defined');
    buildCredentials = {
      [targetName]: prepareTargetCredentials(credentials),
    };
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
      env: ctx.buildProfile.env,
    },
    cache: {
      ...ctx.buildProfile.cache,
      clear: ctx.commandCtx.clearCache,
    },
    secrets: {
      ...(environmentSecrets ? { environmentSecrets } : {}),
      buildCredentials,
    },
  };
}

function prepareTargetCredentials(targetCredentials: IosTargetCredentials): Ios.TargetCredentials {
  return {
    provisioningProfileBase64: targetCredentials.provisioningProfile,
    distributionCertificate: {
      dataBase64: targetCredentials.distributionCertificate.certP12,
      password: targetCredentials.distributionCertificate.certPassword,
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
      targetName: jobData.projectConfiguration.iosApplicationTarget,
      projectArchive: jobData.projectArchive,
    })),
    type: Workflow.GENERIC,
    scheme: jobData.projectConfiguration.iosBuildScheme,
    schemeBuildConfiguration:
      buildProfile.schemeBuildConfiguration === 'Auto'
        ? undefined
        : buildProfile.schemeBuildConfiguration,
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
      targetName: jobData.projectConfiguration.iosApplicationTarget,
      projectArchive: jobData.projectArchive,
    })),
    type: Workflow.MANAGED,
    buildType: buildProfile.buildType,
    username,
    releaseChannel: buildProfile.releaseChannel,
    projectRootDirectory,
  };
}

// copy-pasted from expo-cli/packages/xdl/src/Exp.ts
// it's used in eject
export function sanitizedTargetName(name: string) {
  return name
    .replace(/[\W_]+/g, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}
