import { ArchiveSource, Ios, Job, sanitizeJob } from '@expo/eas-build-job';
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

const cacheDefaults = {
  disabled: false,
  customPaths: [],
  cacheDefaultPaths: true,
};

export async function prepareJobAsync(
  ctx: BuildContext<Platform.IOS>,
  jobData: JobData
): Promise<Job> {
  const projectRootDirectory = path.relative(await vcs.getRootPathAsync(), ctx.projectDir) || '.';
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
      ...cacheDefaults,
      ...ctx.buildProfile.cache,
      clear: ctx.clearCache,
    },
    secrets: {
      buildCredentials,
    },
    releaseChannel: ctx.buildProfile.releaseChannel,
    updates: { channel: ctx.buildProfile.channel },

    scheme: jobData.buildScheme,
    buildConfiguration: ctx.buildProfile.buildConfiguration,
    artifactPath: ctx.buildProfile.artifactPath,

    buildType: ctx.buildProfile.developmentClient
      ? Ios.BuildType.DEVELOPMENT_CLIENT
      : Ios.BuildType.RELEASE,
    username,
  };

  return sanitizeJob(job);
}

function resolveImage(ctx: BuildContext<Platform.IOS>): Ios.BuilderEnvironment['image'] {
  // see https://linear.app/expo/issue/ENG-1396/make-default-image-dependent-on-sdk-version
  if (!ctx.buildProfile.image && ctx.exp.sdkVersion) {
    const majorSdkVersion = semver.major(ctx.exp.sdkVersion);
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
