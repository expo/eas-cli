import { Ios } from '@expo/eas-build-job';
import nullthrows from 'nullthrows';

import { IosJobInput, IosJobSecretsInput } from '../../graphql/generated';
import { transformProjectArchive, transformWorkflow } from '../graphql';

export function transformJob(job: Ios.Job): IosJobInput {
  return {
    type: transformWorkflow(job.type),
    projectArchive: transformProjectArchive(job.projectArchive),
    projectRootDirectory: nullthrows(job.projectRootDirectory),
    releaseChannel: job.releaseChannel,
    updates: job.updates,
    secrets: transformIosSecrets(job.secrets),
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
