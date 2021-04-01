import { Android } from '@expo/eas-build-job';

import { AndroidGenericJobInput, AndroidManagedJobInput } from '../../graphql/generated';
import { transformProjectArchive } from '../graphql';

export function transformGenericJob(job: Android.GenericJob): AndroidGenericJobInput {
  return {
    projectArchive: transformProjectArchive(job.projectArchive),
    projectRootDirectory: job.projectRootDirectory,
    releaseChannel: job.releaseChannel,
    secrets: job.secrets,
    builderEnvironment: job.builderEnvironment,
    cache: job.cache,
    gradleCommand: job.gradleCommand,
    artifactPath: job.artifactPath,
  };
}

export function transformManagedJob(job: Android.ManagedJob): AndroidManagedJobInput {
  return {
    projectArchive: transformProjectArchive(job.projectArchive),
    projectRootDirectory: job.projectRootDirectory,
    releaseChannel: job.releaseChannel,
    secrets: job.secrets,
    builderEnvironment: job.builderEnvironment,
    cache: job.cache,
    username: job.username,
  };
}
