import {
  ArchiveSource,
  BuildMode,
  BuildTrigger,
  Ios,
  Platform,
  sanitizeBuildJob,
} from '@expo/eas-build-job';
import { BuildProfile } from '@expo/eas-json';
import nullthrows from 'nullthrows';
import path from 'path';
import slash from 'slash';

import { IosCredentials, TargetCredentials } from '../../credentials/ios/types';
import { IosJobSecretsInput } from '../../graphql/generated';
import { getCustomBuildConfigPathForJob } from '../../project/customBuildConfig';
import { getUsername } from '../../project/projectUtils';
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
): Promise<Ios.Job> {
  const username = getUsername(ctx.exp, ctx.user);
  const buildProfile: BuildProfile<Platform.IOS> = ctx.buildProfile;
  const projectRootDirectory =
    slash(path.relative(await ctx.vcsClient.getRootPathAsync(), ctx.projectDir)) || '.';
  const buildCredentials: Ios.BuildSecrets['buildCredentials'] = {};
  if (jobData.credentials) {
    const targetNames = Object.keys(jobData.credentials);
    for (const targetName of targetNames) {
      buildCredentials[targetName] = prepareTargetCredentials(jobData.credentials[targetName]);
    }
  }

  const maybeCustomBuildConfigPath = buildProfile.config
    ? getCustomBuildConfigPathForJob(buildProfile.config)
    : undefined;

  let buildMode;
  if (ctx.repack) {
    buildMode = BuildMode.REPACK;
  } else if (buildProfile.config) {
    buildMode = BuildMode.CUSTOM;
  } else {
    buildMode = BuildMode.BUILD;
  }

  const job: Ios.Job = {
    type: ctx.workflow,
    platform: Platform.IOS,
    projectArchive: jobData.projectArchive,
    projectRootDirectory,
    builderEnvironment: {
      image: buildProfile.image,
      node: buildProfile.node,
      pnpm: buildProfile.pnpm,
      bun: buildProfile.bun,
      yarn: buildProfile.yarn,
      bundler: buildProfile.bundler,
      cocoapods: buildProfile.cocoapods,
      fastlane: buildProfile.fastlane,
      env: buildProfile.env,
    },
    cache: {
      ...cacheDefaults,
      ...buildProfile.cache,
      clear: ctx.clearCache,
    },
    secrets: {
      buildCredentials,
    },
    updates: { channel: buildProfile.channel },
    developmentClient: buildProfile.developmentClient,
    simulator: buildProfile.simulator,
    scheme: jobData.buildScheme,
    buildConfiguration: buildProfile.buildConfiguration,
    applicationArchivePath: buildProfile.applicationArchivePath ?? buildProfile.artifactPath,
    buildArtifactPaths: buildProfile.buildArtifactPaths,
    environment: ctx.buildProfile.environment,
    username,
    ...(ctx.ios.buildNumberOverride && {
      version: {
        buildNumber: ctx.ios.buildNumberOverride,
      },
    }),
    experimental: {
      prebuildCommand: buildProfile.prebuildCommand,
    },
    mode: buildMode,
    triggeredBy: BuildTrigger.EAS_CLI,
    ...(maybeCustomBuildConfigPath && {
      customBuildConfig: {
        path: maybeCustomBuildConfigPath,
      },
    }),
    ...(ctx.repack && {
      customBuildConfig: {
        path: '__eas/repack.yml',
      },
    }),
    loggerLevel: ctx.loggerLevel,
    // Technically, these are unused, but let's include them here for type consistency.
    // See: https://github.com/expo/eas-build/pull/454
    appId: ctx.projectId,
    initiatingUserId: ctx.user.id,
  };
  return sanitizeBuildJob(job) as Ios.Job;
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
