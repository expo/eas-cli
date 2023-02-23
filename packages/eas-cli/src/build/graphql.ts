import {
  ArchiveSource,
  ArchiveSourceType,
  BuildTrigger,
  Metadata,
  Workflow,
} from '@expo/eas-build-job';

import {
  BuildCredentialsSource,
  BuildIosEnterpriseProvisioning,
  BuildMetadataInput,
  BuildMode,
  BuildWorkflow,
  DistributionType,
  BuildTrigger as GraphQLBuildTrigger,
  ProjectArchiveSourceInput,
  ProjectArchiveSourceType,
} from '../graphql/generated';

export function transformProjectArchive(archiveSource: ArchiveSource): ProjectArchiveSourceInput {
  if (archiveSource.type === ArchiveSourceType.S3) {
    return {
      type: ProjectArchiveSourceType.S3,
      bucketKey: archiveSource.bucketKey,
    };
  } else if (archiveSource.type === ArchiveSourceType.GCS) {
    return {
      type: ProjectArchiveSourceType.Gcs,
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
    ...metadata,
    buildMode: metadata.buildMode && transformBuildMode(metadata.buildMode),
    credentialsSource:
      metadata.credentialsSource && transformCredentialsSource(metadata.credentialsSource),
    distribution: metadata.distribution && transformDistribution(metadata.distribution),
    workflow: metadata.workflow && transformWorkflow(metadata.workflow),
    iosEnterpriseProvisioning:
      metadata.iosEnterpriseProvisioning &&
      transformIosEnterpriseProvisioning(metadata.iosEnterpriseProvisioning),
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

export function transformWorkflow(workflow: Workflow): BuildWorkflow {
  if (workflow === Workflow.GENERIC) {
    return BuildWorkflow.Generic;
  } else {
    return BuildWorkflow.Managed;
  }
}

export function transformIosEnterpriseProvisioning(
  enterpriseProvisioning: Metadata['iosEnterpriseProvisioning']
): BuildIosEnterpriseProvisioning {
  if (enterpriseProvisioning === 'adhoc') {
    return BuildIosEnterpriseProvisioning.Adhoc;
  } else {
    return BuildIosEnterpriseProvisioning.Universal;
  }
}

// TODO: check what in metadata
export function transformBuildMode(buildMode: string): BuildMode {
  if (buildMode === 'build') {
    return BuildMode.Build;
  } else if (buildMode === 'resign') {
    return BuildMode.Resign;
  } else if (buildMode === 'custom') {
    return BuildMode.Custom;
  } else {
    throw new Error(`Unsupported build mode: ${buildMode}`);
  }
}

export function transformBuildTrigger(buildTrigger: BuildTrigger): GraphQLBuildTrigger {
  if (buildTrigger === BuildTrigger.EAS_CLI) {
    return GraphQLBuildTrigger.EasCli;
  } else if (buildTrigger === BuildTrigger.GIT_BASED_INTEGRATION) {
    return GraphQLBuildTrigger.GitBasedIntegration;
  }
  throw new Error('Unknown build trigger');
}
