import {
  ArchiveSource,
  ArchiveSourceType,
  BuildMode,
  BuildTrigger,
  FingerprintSourceType,
  Metadata,
  Workflow,
} from '@expo/eas-build-job';
import { LoggerLevel } from '@expo/logger';
import assert from 'assert';

import {
  BuildCredentialsSource,
  BuildIosEnterpriseProvisioning,
  BuildMetadataInput,
  BuildWorkflow,
  DistributionType,
  FingerprintSourceInput,
  BuildMode as GraphQLBuildMode,
  BuildTrigger as GraphQLBuildTrigger,
  FingerprintSourceType as GraphQLFingeprintSourceType,
  ProjectArchiveSourceInput,
  ProjectArchiveSourceType,
  WorkerLoggerLevel,
} from '../graphql/generated';

export function transformProjectArchive(archiveSource: ArchiveSource): ProjectArchiveSourceInput {
  if (archiveSource.type === ArchiveSourceType.GCS) {
    return {
      type: ProjectArchiveSourceType.Gcs,
      bucketKey: archiveSource.bucketKey,
      metadataLocation: archiveSource.metadataLocation,
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
    fingerprintSource:
      metadata.fingerprintSource && transformFingerprintSource(metadata.fingerprintSource),
    credentialsSource:
      metadata.credentialsSource && transformCredentialsSource(metadata.credentialsSource),
    distribution: metadata.distribution && transformDistribution(metadata.distribution),
    workflow: metadata.workflow && transformWorkflow(metadata.workflow),
    iosEnterpriseProvisioning:
      metadata.iosEnterpriseProvisioning &&
      transformIosEnterpriseProvisioning(metadata.iosEnterpriseProvisioning),
  };
}

export function transformFingerprintSource(
  fingerprintSource: NonNullable<Metadata['fingerprintSource']>
): FingerprintSourceInput | null {
  if (fingerprintSource.type !== FingerprintSourceType.GCS) {
    return null;
  }

  return {
    type: GraphQLFingeprintSourceType.Gcs,
    bucketKey: fingerprintSource.bucketKey,
    isDebugFingerprint: fingerprintSource.isDebugFingerprint,
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

const buildModeToGraphQLBuildMode: Record<BuildMode, GraphQLBuildMode> = {
  [BuildMode.BUILD]: GraphQLBuildMode.Build,
  [BuildMode.CUSTOM]: GraphQLBuildMode.Custom,
  [BuildMode.RESIGN]: GraphQLBuildMode.Resign,
  [BuildMode.REPACK]: GraphQLBuildMode.Repack,
};

export function transformBuildMode(buildMode: BuildMode): GraphQLBuildMode {
  const graphQLBuildMode = buildModeToGraphQLBuildMode[buildMode];
  assert(graphQLBuildMode, `Unsupported build mode: ${buildMode}`);
  return graphQLBuildMode;
}

export function transformBuildTrigger(buildTrigger: BuildTrigger): GraphQLBuildTrigger {
  if (buildTrigger === BuildTrigger.EAS_CLI) {
    return GraphQLBuildTrigger.EasCli;
  } else if (buildTrigger === BuildTrigger.GIT_BASED_INTEGRATION) {
    return GraphQLBuildTrigger.GitBasedIntegration;
  }
  throw new Error('Unknown build trigger');
}

export const loggerLevelToGraphQLWorkerLoggerLevel: Record<LoggerLevel, WorkerLoggerLevel> = {
  [LoggerLevel.TRACE]: WorkerLoggerLevel.Trace,
  [LoggerLevel.DEBUG]: WorkerLoggerLevel.Debug,
  [LoggerLevel.INFO]: WorkerLoggerLevel.Info,
  [LoggerLevel.WARN]: WorkerLoggerLevel.Warn,
  [LoggerLevel.ERROR]: WorkerLoggerLevel.Error,
  [LoggerLevel.FATAL]: WorkerLoggerLevel.Fatal,
};
