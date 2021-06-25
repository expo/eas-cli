import { Android } from '@expo/eas-build-job';

import { AndroidBuildType, AndroidJobInput } from '../../graphql/generated';
import { transformProjectArchive, transformWorkflow } from '../graphql';

export function transformJob(job: Android.Job): AndroidJobInput {
  return {
    type: transformWorkflow(job.type),
    projectArchive: transformProjectArchive(job.projectArchive),
    projectRootDirectory: job.projectRootDirectory,
    releaseChannel: job.releaseChannel,
    updates: job.updates,
    secrets: job.secrets,
    builderEnvironment: job.builderEnvironment,
    cache: job.cache,
    gradleCommand: job.gradleCommand,
    artifactPath: job.artifactPath,
    username: job.username,
    buildType: job.buildType && transformBuildType(job.buildType),
  };
}

function transformBuildType(buildType: Android.BuildType): AndroidBuildType {
  if (buildType === Android.BuildType.APK) {
    return AndroidBuildType.Apk;
  } else if (buildType === Android.BuildType.APP_BUNDLE) {
    return AndroidBuildType.AppBundle;
  } else {
    return AndroidBuildType.DevelopmentClient;
  }
}
