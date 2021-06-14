import { Env, Ios } from '@expo/eas-build-job';
import nullthrows from 'nullthrows';

import {
  DistributionType,
  IosGenericJobInput,
  IosJobSecretsInput,
  IosManagedBuildType,
  IosManagedJobInput,
} from '../../graphql/generated';
import { transformProjectArchive } from '../graphql';

export function transformGenericJob(job: Ios.GenericJob): IosGenericJobInput {
  return {
    projectArchive: transformProjectArchive(job.projectArchive),
    projectRootDirectory: job.projectRootDirectory,
    releaseChannel: job.releaseChannel,
    updates: job.updates,
    distribution: job.distribution && transformDistributionType(job.distribution),
    secrets: transformIosSecrets(job.secrets),
    builderEnvironment: job.builderEnvironment,
    cache: job.cache,
    scheme: job.scheme,
    buildConfiguration: job.buildConfiguration,
    artifactPath: job.artifactPath,
  };
}

export function transformManagedJob(job: Ios.ManagedJob): IosManagedJobInput {
  return {
    projectArchive: transformProjectArchive(job.projectArchive),
    projectRootDirectory: job.projectRootDirectory,
    releaseChannel: job.releaseChannel,
    updates: job.updates,
    distribution: job.distribution && transformDistributionType(job.distribution),
    secrets: transformIosSecrets(job.secrets),
    builderEnvironment: job.builderEnvironment,
    cache: job.cache,
    buildType: job.buildType && transformBuildType(job.buildType),
    username: job.username,
  };
}

function transformDistributionType(distributionType: Ios.DistributionType): DistributionType {
  if (distributionType === 'store') {
    return DistributionType.Store;
  } else if (distributionType === 'internal') {
    return DistributionType.Internal;
  } else {
    return DistributionType.Simulator;
  }
}

function transformIosSecrets(secrets: {
  buildCredentials?: Ios.BuildCredentials;
  env?: Env;
}): IosJobSecretsInput {
  const buildCredentials: IosJobSecretsInput['buildCredentials'] = [];

  for (const targetName of Object.keys(secrets.buildCredentials ?? {})) {
    buildCredentials.push({
      targetName,
      provisioningProfileBase64: nullthrows(secrets.buildCredentials?.[targetName])
        .provisioningProfileBase64,
      distributionCertificate: nullthrows(secrets.buildCredentials?.[targetName])
        .distributionCertificate,
    });
  }

  return {
    buildCredentials,
    environmentSecrets: secrets.env,
  };
}

function transformBuildType(buildType: Ios.ManagedBuildType): IosManagedBuildType {
  if (buildType === Ios.ManagedBuildType.DEVELOPMENT_CLIENT) {
    return IosManagedBuildType.DevelopmentClient;
  } else {
    return IosManagedBuildType.Release;
  }
}
