import { Ios } from '@expo/eas-build-job';
import nullthrows from 'nullthrows';

import { IosJobInput, IosJobSecretsInput } from '../../graphql/generated';
import {
  loggerLevelToGraphQLWorkerLoggerLevel,
  transformBuildMode,
  transformBuildTrigger,
  transformProjectArchive,
  transformWorkflow,
} from '../graphql';
import { buildProfileEnvironmentToEnvironment } from '../utils/environment';

export function transformJob(job: Ios.Job): IosJobInput {
  return {
    type: transformWorkflow(job.type),
    triggeredBy: transformBuildTrigger(job.triggeredBy),
    projectArchive: transformProjectArchive(job.projectArchive),
    projectRootDirectory: nullthrows(job.projectRootDirectory),
    updates: job.updates,
    secrets: job.secrets ? transformIosSecrets(job.secrets) : undefined,
    builderEnvironment: job.builderEnvironment,
    cache: job.cache,
    version: job.version?.buildNumber ? { buildNumber: job.version.buildNumber } : undefined,
    scheme: job.scheme,
    buildConfiguration: job.buildConfiguration,
    applicationArchivePath: job.applicationArchivePath,
    buildArtifactPaths: job.buildArtifactPaths,
    username: job.username,
    developmentClient: job.developmentClient,
    simulator: job.simulator,
    experimental: job.experimental,
    mode: transformBuildMode(job.mode),
    customBuildConfig: job.customBuildConfig,
    environment: buildProfileEnvironmentToEnvironment(job.environment),
    loggerLevel: job.loggerLevel
      ? loggerLevelToGraphQLWorkerLoggerLevel[job.loggerLevel]
      : undefined,
  };
}

export function transformIosSecrets(secrets: {
  buildCredentials?: Ios.BuildCredentials;
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
  };
}
