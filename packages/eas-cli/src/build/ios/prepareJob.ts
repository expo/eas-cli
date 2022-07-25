import { ArchiveSource, Ios, Job, Platform, sanitizeJob } from '@expo/eas-build-job';
import path from 'path';
import slash from 'slash';

import { IosCredentials, TargetCredentials } from '../../credentials/ios/types';
import { getUsername } from '../../project/projectUtils';
import { ensureLoggedInAsync } from '../../user/actions';
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
  const username = getUsername(ctx.exp, await ensureLoggedInAsync());
  const buildCredentials: Ios.Job['secrets']['buildCredentials'] = {};
  if (jobData.credentials) {
    const targetNames = Object.keys(jobData.credentials);
    for (const targetName of targetNames) {
      buildCredentials[targetName] = prepareTargetCredentials(jobData.credentials[targetName]);
    }
  }

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
    artifactPath: ctx.buildProfile.artifactPath,
    username,
    ...(ctx.ios.overrideBuildNumber && {
      version: {
        buildNumber: ctx.ios.overrideBuildNumber,
      },
    }),
    experimental: {
      prebuildCommand: ctx.buildProfile.prebuildCommand,
    },
  };
  return sanitizeJob(job);
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
