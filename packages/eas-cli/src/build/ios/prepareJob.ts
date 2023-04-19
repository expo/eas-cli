import {
  ArchiveSource,
  BuildMode,
  BuildTrigger,
  Ios,
  Job,
  Platform,
  sanitizeJob,
} from '@expo/eas-build-job';
import { Cache } from '@expo/eas-build-job/dist/common';
import { BuildProfile } from '@expo/eas-json';
import nullthrows from 'nullthrows';
import path from 'path';
import slash from 'slash';

import { IosCredentials, TargetCredentials } from '../../credentials/ios/types';
import { IosJobSecretsInput } from '../../graphql/generated';
import { getCustomBuildConfigPath } from '../../project/customBuildConfig';
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
  paths: [],
};

export async function prepareJobAsync(
  ctx: BuildContext<Platform.IOS>,
  jobData: JobData
): Promise<Job> {
  const username = getUsername(ctx.exp, ctx.user);
  const buildProfile: BuildProfile<Platform.IOS> = ctx.buildProfile;
  const projectRootDirectory =
    slash(path.relative(await getVcsClient().getRootPathAsync(), ctx.projectDir)) || '.';
  const buildCredentials: Ios.BuildSecrets['buildCredentials'] = {};
  if (jobData.credentials) {
    const targetNames = Object.keys(jobData.credentials);
    for (const targetName of targetNames) {
      buildCredentials[targetName] = prepareTargetCredentials(jobData.credentials[targetName]);
    }
  }

  const maybeCustomBuildConfigPath = buildProfile.config
    ? getCustomBuildConfigPath(buildProfile.config)
    : undefined;

  const job: Ios.Job = {
    type: ctx.workflow,
    platform: Platform.IOS,
    projectArchive: jobData.projectArchive,
    projectRootDirectory,
    builderEnvironment: {
      image: buildProfile.image,
      node: buildProfile.node,
      yarn: buildProfile.yarn,
      bundler: buildProfile.bundler,
      cocoapods: buildProfile.cocoapods,
      fastlane: buildProfile.fastlane,
      expoCli: buildProfile.expoCli,
      env: buildProfile.env,
    },
    cache: getCacheSettings(buildProfile, ctx),
    secrets: {
      buildCredentials,
    },
    releaseChannel: buildProfile.releaseChannel,
    updates: { channel: buildProfile.channel },
    developmentClient: buildProfile.developmentClient,
    simulator: buildProfile.simulator,
    scheme: jobData.buildScheme,
    buildConfiguration: buildProfile.buildConfiguration,
    applicationArchivePath: buildProfile.applicationArchivePath ?? buildProfile.artifactPath,
    buildArtifactPaths: buildProfile.buildArtifactPaths,
    username,
    ...(ctx.ios.buildNumberOverride && {
      version: {
        buildNumber: ctx.ios.buildNumberOverride,
      },
    }),
    experimental: {
      prebuildCommand: buildProfile.prebuildCommand,
    },
    mode: buildProfile.config ? BuildMode.CUSTOM : BuildMode.BUILD,
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

function getCacheSettings(
  buildProfile: BuildProfile<Platform.IOS>,
  ctx: BuildContext<Platform.IOS>
): Cache {
  const cacheSettings = {
    ...cacheDefaults,
    ...buildProfile.cache,
    clear: ctx.clearCache,
  };
  if (cacheSettings.customPaths) {
    if (cacheSettings.customPaths.length > 0) {
      cacheSettings.paths.push(...cacheSettings.customPaths);
    }
    delete cacheSettings.customPaths;
  }
  return cacheSettings;
}
