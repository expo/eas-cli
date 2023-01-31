import { Android } from '@expo/eas-build-job';

import { AndroidBuildType, AndroidJobInput } from '../../graphql/generated';
import { transformBuildTrigger, transformProjectArchive, transformWorkflow } from '../graphql';

export function transformJob(job: Android.Job): AndroidJobInput {
  return {
    type: transformWorkflow(job.type),
    triggeredBy: transformBuildTrigger(job.triggeredBy),
    projectArchive: transformProjectArchive(job.projectArchive),
    projectRootDirectory: job.projectRootDirectory,
    releaseChannel: job.releaseChannel,
    updates: job.updates,
    secrets: job.secrets,
    builderEnvironment: job.builderEnvironment,
    cache: job.cache,
    version: job.version?.versionCode ? { versionCode: job.version.versionCode } : undefined,
    gradleCommand: job.gradleCommand,
    applicationArchivePath: job.applicationArchivePath,
    buildArtifactPaths: job.buildArtifactPaths,
    username: job.username,
    buildType: job.buildType && transformBuildType(job.buildType),
    developmentClient: job.developmentClient,
    experimental: job.experimental,
  };
}

function transformBuildType(buildType: Android.BuildType): AndroidBuildType {
  if (buildType === Android.BuildType.APK) {
    return AndroidBuildType.Apk;
  } else {
    return AndroidBuildType.AppBundle;
  }
}
