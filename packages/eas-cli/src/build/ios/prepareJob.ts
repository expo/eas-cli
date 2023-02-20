import {
  ArchiveSource,
  BuildMode,
  BuildTrigger,
  Ios,
  Job,
  Platform,
  sanitizeJob,
} from '@expo/eas-build-job';
import nullthrows from 'nullthrows';
import path from 'path';
import slash from 'slash';

import { IosCredentials, TargetCredentials } from '../../credentials/ios/types';
import { IosJobSecretsInput } from '../../graphql/generated';
import { getUsername } from '../../project/projectUtils';
import { getVcsClient } from '../../vcs';
import { BuildContext } from '../context';

interface JobData {
  projectArchive: ArchiveSource;
  credentials?: IosCredentials;
  buildScheme: string;
}

const cacheDefaults = {
  disabled: false,
  customPaths: [],
  cacheDefaultPaths: true,
};

export async function prepareJobAsync(
  ctx: BuildContext<Platform.IOS>,
  jobData: JobData
): Promise<Job> {
  const projectRootDirectory =
    slash(path.relative(await getVcsClient().getRootPathAsync(), ctx.projectDir)) || '.';
  const username = getUsername(ctx.exp, ctx.user);
  const buildCredentials: Ios.BuildSecrets['buildCredentials'] = {};
  if (jobData.credentials) {
    const targetNames = Object.keys(jobData.credentials);
    for (const targetName of targetNames) {
      buildCredentials[targetName] = prepareTargetCredentials(jobData.credentials[targetName]);
    }
  }

  const maybeCustomBuildConfigPath = ctx.buildProfile.config
    ? path.join('.eas/build', ctx.buildProfile.config)
    : undefined;

  const job: Ios.Job = {
    type: ctx.workflow,
    platform: Platform.IOS,
    projectArchive: jobData.projectArchive,
    projectRootDirectory,
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
      ...cacheDefaults,
      ...ctx.buildProfile.cache,
      clear: ctx.clearCache,
    },
    secrets: {
      buildCredentials,
    },
    releaseChannel: ctx.buildProfile.releaseChannel,
    updates: { channel: ctx.buildProfile.channel },
    developmentClient: ctx.buildProfile.developmentClient,
    simulator: ctx.buildProfile.simulator,
    scheme: jobData.buildScheme,
    buildConfiguration: ctx.buildProfile.buildConfiguration,
    applicationArchivePath:
      ctx.buildProfile.applicationArchivePath ?? ctx.buildProfile.artifactPath,
    buildArtifactPaths: ctx.buildProfile.buildArtifactPaths,
    username,
    ...(ctx.ios.buildNumberOverride && {
      version: {
        buildNumber: ctx.ios.buildNumberOverride,
      },
    }),
    experimental: {
      prebuildCommand: ctx.buildProfile.prebuildCommand,
    },
    mode: ctx.buildProfile.config ? BuildMode.CUSTOM : BuildMode.BUILD,
    triggeredBy: BuildTrigger.EAS_CLI,
    ...(maybeCustomBuildConfigPath && {
      customBuildConfig: {
        path: maybeCustomBuildConfigPath,
      },
    }),
  };
  return sanitizeJob(job);
}

export function prepareCredentialsToResign(credentials: IosCredentials): IosJobSecretsInput {
  const buildCredentials: IosJobSecretsInput['buildCredentials'] = [];
  for (const targetName of Object.keys(credentials ?? {})) {
    buildCredentials.push({
      targetName,
      provisioningProfileBase64: nullthrows(credentials?.[targetName].provisioningProfile),
      distributionCertificate: {
        dataBase64: nullthrows(credentials?.[targetName].distributionCertificate.certificateP12),
        password: nullthrows(credentials?.[targetName].distributionCertificate.certificatePassword),
      },
    });
  }

  return { buildCredentials };
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
