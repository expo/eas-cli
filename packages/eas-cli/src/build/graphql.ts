import { ArchiveSource, ArchiveSourceType, Metadata, Workflow } from '@expo/eas-build-job';

import {
  BuildCredentialsSource,
  BuildMetadataInput,
  BuildWorkflow,
  DistributionType,
  ProjectArchiveSourceInput,
  ProjectArchiveSourceType,
} from '../graphql/generated';

export function transformProjectArchive(archiveSource: ArchiveSource): ProjectArchiveSourceInput {
  if (archiveSource.type === ArchiveSourceType.S3) {
    return {
      type: ProjectArchiveSourceType.S3,
      bucketKey: archiveSource.bucketKey,
    };
  } else if (archiveSource.type === ArchiveSourceType.URL) {
    return {
      type: ProjectArchiveSourceType.Url,
      url: archiveSource.url,
    };
  } else {
    throw new Error(`Unsupported project archive source type: '${archiveSource.type}'`);
  }
}

export function transformMetadata(metadata: Metadata): BuildMetadataInput {
  return {
    appIdentifier: metadata.appIdentifier,
    appName: metadata.appName,
    appVersion: metadata.appVersion,
    buildProfile: metadata.buildProfile,
    cliVersion: metadata.cliVersion,
    credentialsSource:
      metadata.credentialsSource && transformCredentialsSource(metadata.credentialsSource),
    distribution: metadata.distribution && transformDistribution(metadata.distribution),
    gitCommitHash: metadata.gitCommitHash,
    releaseChannel: metadata.releaseChannel,
    sdkVersion: metadata.sdkVersion,
    trackingContext: metadata.trackingContext,
    workflow: metadata.workflow && transformWorkflow(metadata.workflow),
  };
}

function transformCredentialsSource(
  credentialsSource: Metadata['credentialsSource']
): BuildCredentialsSource {
  if (credentialsSource === 'local') {
    return BuildCredentialsSource.Local;
  } else {
    return BuildCredentialsSource.Remote;
  }
}

function transformDistribution(distribution: Metadata['distribution']): DistributionType {
  if (distribution === 'internal') {
    return DistributionType.Internal;
  } else if (distribution === 'simulator') {
    return DistributionType.Simulator;
  } else {
    return DistributionType.Store;
  }
}

function transformWorkflow(workflow: Metadata['workflow']): BuildWorkflow {
  if (workflow === Workflow.GENERIC) {
    return BuildWorkflow.Generic;
  } else {
    return BuildWorkflow.Managed;
  }
}
