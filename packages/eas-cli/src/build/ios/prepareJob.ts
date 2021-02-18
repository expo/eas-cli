import {
  ArchiveSource,
  ArchiveSourceType,
  Job,
  Workflow,
  iOS,
  sanitizeJob,
} from '@expo/eas-build-job';
import { iOSGenericBuildProfile, iOSManagedBuildProfile } from '@expo/eas-json';
import assert from 'assert';
import path from 'path';

import {
  IosCredentials,
  IosTargetCredentials,
  isCredentialsMap,
  readSecretEnvsAsync,
} from '../../credentials/credentialsJson/read';
import { getProjectAccountNameAsync } from '../../project/projectUtils';
import { gitRootDirectoryAsync } from '../../utils/git';
import { BuildContext } from '../context';
import { Platform } from '../types';

interface JobData {
  archiveBucketKey: string;
  credentials?: IosCredentials;
  projectConfiguration: {
    iosBuildScheme?: string;
    iosApplicationTarget?: string;
  };
}

export async function prepareJobAsync(
  ctx: BuildContext<Platform.iOS>,
  jobData: JobData
): Promise<Job> {
  if (ctx.buildProfile.workflow === Workflow.Generic) {
    const partialJob = await prepareGenericJobAsync(ctx, jobData, ctx.buildProfile);
    return sanitizeJob(partialJob);
  } else if (ctx.buildProfile.workflow === Workflow.Managed) {
    const partialJob = await prepareManagedJobAsync(ctx, jobData, ctx.buildProfile);
    return sanitizeJob(partialJob);
  } else {
    throw new Error("Unknown workflow. Shouldn't happen");
  }
}

interface CommonJobProperties {
  platform: Platform.iOS;
  projectArchive: ArchiveSource;
  builderEnvironment: iOS.BuilderEnvironment;
  releaseChannel: string;
  distribution?: iOS.DistributionType;
  secrets: {
    buildCredentials: iOS.BuildCredentials;
    secretEnvs?: Record<string, string>;
  };
}

async function prepareJobCommonAsync(
  ctx: BuildContext<Platform.iOS>,
  {
    archiveBucketKey,
    credentials,
    targetName,
  }: { archiveBucketKey: string; credentials?: IosCredentials; targetName?: string }
): Promise<Partial<CommonJobProperties>> {
  const secretEnvs = await readSecretEnvsAsync(ctx.commandCtx.projectDir);

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
    platform: Platform.iOS,
    projectArchive: {
      type: ArchiveSourceType.S3,
      bucketKey: archiveBucketKey,
    },
    distribution: ctx.buildProfile.distribution,
    builderEnvironment: {
      image: ctx.buildProfile.image,
      node: ctx.buildProfile.node,
      yarn: ctx.buildProfile.yarn,
      cocoapods: ctx.buildProfile.cocoapods,
      fastlane: ctx.buildProfile.fastlane,
      env: ctx.buildProfile.env,
    },
    secrets: {
      ...(secretEnvs ? { secretEnvs } : {}),
      buildCredentials,
    },
  };
}

function prepareTargetCredentials(targetCredentials: IosTargetCredentials): iOS.TargetCredentials {
  return {
    provisioningProfileBase64: targetCredentials.provisioningProfile,
    distributionCertificate: {
      dataBase64: targetCredentials.distributionCertificate.certP12,
      password: targetCredentials.distributionCertificate.certPassword,
    },
  };
}

async function prepareGenericJobAsync(
  ctx: BuildContext<Platform.iOS>,
  jobData: JobData,
  buildProfile: iOSGenericBuildProfile
): Promise<Partial<iOS.GenericJob>> {
  const projectRootDirectory =
    path.relative(await gitRootDirectoryAsync(), ctx.commandCtx.projectDir) || '.';
  return {
    ...(await prepareJobCommonAsync(ctx, {
      archiveBucketKey: jobData.archiveBucketKey,
      credentials: jobData.credentials,
      targetName: jobData.projectConfiguration.iosApplicationTarget,
    })),
    type: Workflow.Generic,
    scheme: jobData.projectConfiguration.iosBuildScheme,
    schemeBuildConfiguration: buildProfile.schemeBuildConfiguration,
    artifactPath: buildProfile.artifactPath,
    releaseChannel: buildProfile.releaseChannel,
    projectRootDirectory,
  };
}

async function prepareManagedJobAsync(
  ctx: BuildContext<Platform.iOS>,
  jobData: JobData,
  buildProfile: iOSManagedBuildProfile
): Promise<Partial<iOS.ManagedJob>> {
  const projectRootDirectory =
    path.relative(await gitRootDirectoryAsync(), ctx.commandCtx.projectDir) || '.';
  const accountName = await getProjectAccountNameAsync(ctx.commandCtx.projectDir);
  const targetName = sanitizedName(ctx.commandCtx.exp.name);
  return {
    ...(await prepareJobCommonAsync(ctx, {
      archiveBucketKey: jobData.archiveBucketKey,
      credentials: jobData.credentials,
      targetName,
    })),
    type: Workflow.Managed,
    buildType: buildProfile.buildType,
    username: accountName,
    releaseChannel: buildProfile.releaseChannel,
    projectRootDirectory,
  };
}

// copy-pasted from expo-cli/packages/xdl/src/Exp.ts
// it's used in eject
function sanitizedName(name: string) {
  return name
    .replace(/[\W_]+/g, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}
