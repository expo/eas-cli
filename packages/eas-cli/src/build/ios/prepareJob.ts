import {
  ArchiveSource,
  ArchiveSourceType,
  Job,
  Workflow,
  iOS,
  sanitizeJob,
} from '@expo/eas-build-job';
import { iOSGenericBuildProfile, iOSManagedBuildProfile } from '@expo/eas-json';
import path from 'path';

import { readSecretEnvsAsync } from '../../credentials/credentialsJson/read';
import { IosCredentials } from '../../credentials/ios/IosCredentialsProvider';
import { ensureLoggedInAsync } from '../../user/actions';
import { gitRootDirectoryAsync } from '../../utils/git';
import { BuildContext } from '../context';
import { Platform } from '../types';

interface JobData {
  archiveBucketKey: string;
  credentials?: IosCredentials;
  projectConfiguration: {
    iosNativeProjectScheme?: string;
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
  releaseChannel: string;
  secrets: {
    buildCredentials?: {
      provisioningProfileBase64: string;
      distributionCertificate: {
        dataBase64: string;
        password: string;
      };
    };
    secretEnvs?: Record<string, string>;
  };
}

async function prepareJobCommonAsync(
  ctx: BuildContext<Platform.iOS>,
  jobData: JobData
): Promise<Partial<CommonJobProperties>> {
  const secretEnvs = await readSecretEnvsAsync(ctx.commandCtx.projectDir);
  const buildCredentials = jobData.credentials
    ? {
        buildCredentials: {
          provisioningProfileBase64: jobData.credentials.provisioningProfile,
          distributionCertificate: {
            dataBase64: jobData.credentials.distributionCertificate.certP12,
            password: jobData.credentials.distributionCertificate.certPassword,
          },
        },
      }
    : {};

  return {
    platform: Platform.iOS,
    projectArchive: {
      type: ArchiveSourceType.S3,
      bucketKey: jobData.archiveBucketKey,
    },
    secrets: {
      ...(secretEnvs ? { secretEnvs } : {}),
      ...buildCredentials,
    },
  };
}

async function prepareGenericJobAsync(
  ctx: BuildContext<Platform.iOS>,
  jobData: JobData,
  buildProfile: iOSGenericBuildProfile
): Promise<Partial<iOS.GenericJob>> {
  const projectRootDirectory = path.relative(await gitRootDirectoryAsync(), process.cwd()) || '.';
  return {
    ...(await prepareJobCommonAsync(ctx, jobData)),
    type: Workflow.Generic,
    scheme: jobData.projectConfiguration.iosNativeProjectScheme,
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
  const projectRootDirectory = path.relative(await gitRootDirectoryAsync(), process.cwd()) || '.';
  const { username } = await ensureLoggedInAsync();
  return {
    ...(await prepareJobCommonAsync(ctx, jobData)),
    type: Workflow.Managed,
    username,
    releaseChannel: buildProfile.releaseChannel,
    projectRootDirectory,
  };
}
