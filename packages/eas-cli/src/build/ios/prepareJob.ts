import { Workflow, iOSGenericBuildProfile, iOSManagedBuildProfile } from '@eas/config';
import { BuildType, Job, iOS, sanitizeJob } from '@expo/eas-build-job';
import path from 'path';

import { readSecretEnvsAsync } from '../../credentials/credentialsJson/read';
import { IosCredentials } from '../../credentials/ios/IosCredentialsProvider';
import { gitRootDirectoryAsync } from '../../utils/git';
import { BuildContext } from '../context';
import { Platform } from '../types';

interface CommonJobProperties {
  platform: Platform.iOS;
  projectUrl: string;
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

interface JobData {
  archiveUrl: string;
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
    projectUrl: jobData.archiveUrl,
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
    type: BuildType.Generic,
    scheme: jobData.projectConfiguration.iosNativeProjectScheme,
    artifactPath: buildProfile.artifactPath,
    projectRootDirectory,
  };
}

async function prepareManagedJobAsync(
  ctx: BuildContext<Platform.iOS>,
  jobData: JobData,
  _buildProfile: iOSManagedBuildProfile
): Promise<Partial<iOS.ManagedJob>> {
  return {
    ...(await prepareJobCommonAsync(ctx, jobData)),
    type: BuildType.Managed,
    packageJson: { example: 'packageJson' },
    manifest: { example: 'manifest' },
  };
}
