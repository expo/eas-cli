import { Flags } from '@oclif/core';

import { BUILDS_LIMIT, listAndRenderBuildsOnAppAsync } from '../../build/queries';
import {
  BuildDistributionType,
  BuildStatus,
  maybeGetBuildDistributionType,
  maybeGetBuildStatus,
} from '../../build/types';
import EasCommand from '../../commandUtils/EasCommand';
import { EasNonInteractiveAndJsonFlags } from '../../commandUtils/flags';
import {
  EasPaginatedQueryFlags,
  getLimitFlagWithCustomValues,
  getPaginatedQueryOptions,
} from '../../commandUtils/pagination';
import { AppPlatform, BuildStatus as GraphQLBuildStatus } from '../../graphql/generated';
import { RequestedPlatform, maybeGetRequestedPlatform } from '../../platform';
import { getDisplayNameForProjectIdAsync } from '../../project/projectUtils';
import { buildDistributionTypeToGraphQLDistributionType } from '../../utils/buildDistribution';
import { enableJsonOutput } from '../../utils/json';

interface RawBuildListFlags {
  platform?: string;
  status?: string;
  distribution?: string;
  channel?: string;
  appVersion?: string;
  appBuildVersion?: string;
  sdkVersion?: string;
  runtimeVersion?: string;
  appIdentifier?: string;
  buildProfile?: string;
  gitCommitHash?: string;
  offset?: number;
  limit?: number;
  json?: boolean;
  'non-interactive'?: boolean;
}

interface BuildListCommandFlags {
  platform?: RequestedPlatform;
  status?: BuildStatus;
  distribution?: BuildDistributionType;
  channel?: string;
  appVersion?: string;
  appBuildVersion?: string;
  sdkVersion?: string;
  runtimeVersion?: string;
  appIdentifier?: string;
  buildProfile?: string;
  gitCommitHash?: string;
  offset?: number;
  limit?: number;
  json?: boolean;
  'non-interactive': boolean;
}

const PLATFORM_FLAG_OPTIONS = [
  RequestedPlatform.All,
  RequestedPlatform.Android,
  RequestedPlatform.Ios,
];
const STATUS_FLAG_OPTIONS = [
  BuildStatus.NEW,
  BuildStatus.IN_QUEUE,
  BuildStatus.IN_PROGRESS,
  BuildStatus.PENDING_CANCEL,
  BuildStatus.ERRORED,
  BuildStatus.FINISHED,
  BuildStatus.CANCELED,
];
const DISTRIBUTION_FLAG_OPTIONS = [
  BuildDistributionType.STORE,
  BuildDistributionType.INTERNAL,
  BuildDistributionType.SIMULATOR,
];

export default class BuildList extends EasCommand {
  static override description = 'list all builds for your project';

  static override flags = {
    platform: Flags.string({
      options: PLATFORM_FLAG_OPTIONS,
    }),
    status: Flags.string({
      options: STATUS_FLAG_OPTIONS,
    }),
    distribution: Flags.string({
      options: DISTRIBUTION_FLAG_OPTIONS,
    }),
    channel: Flags.string(),
    appVersion: Flags.string(),
    appBuildVersion: Flags.string(),
    sdkVersion: Flags.string(),
    runtimeVersion: Flags.string(),
    appIdentifier: Flags.string(),
    buildProfile: Flags.string(),
    gitCommitHash: Flags.string(),
    ...EasPaginatedQueryFlags,
    limit: getLimitFlagWithCustomValues({ defaultTo: 10, limit: BUILDS_LIMIT }),
    ...EasNonInteractiveAndJsonFlags,
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectConfig,
    ...this.ContextOptions.LoggedIn,
    ...this.ContextOptions.Vcs,
  };

  async runAsync(): Promise<void> {
    const { flags: rawFlags } = await this.parse(BuildList);
    const flags = await this.sanitizeFlagsAsync(rawFlags);
    const paginatedQueryOptions = getPaginatedQueryOptions(flags);
    const {
      json: jsonFlag,
      platform: requestedPlatform,
      status: buildStatus,
      distribution: buildDistribution,
      'non-interactive': nonInteractive,
    } = flags;
    const {
      privateProjectConfig: { projectId },
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(BuildList, {
      nonInteractive,
    });
    if (jsonFlag) {
      enableJsonOutput();
    }

    const platform = toAppPlatform(requestedPlatform);
    const graphqlBuildStatus = toGraphQLBuildStatus(buildStatus);
    const graphqlBuildDistribution =
      buildDistributionTypeToGraphQLDistributionType(buildDistribution);
    const displayName = await getDisplayNameForProjectIdAsync(graphqlClient, projectId);

    await listAndRenderBuildsOnAppAsync(graphqlClient, {
      projectId,
      projectDisplayName: displayName,
      filter: {
        platform,
        status: graphqlBuildStatus,
        distribution: graphqlBuildDistribution,
        channel: flags.channel,
        appVersion: flags.appVersion,
        appBuildVersion: flags.appBuildVersion,
        sdkVersion: flags.sdkVersion,
        runtimeVersion: flags.runtimeVersion,
        appIdentifier: flags.appIdentifier,
        buildProfile: flags.buildProfile,
        gitCommitHash: flags.gitCommitHash,
      },
      paginatedQueryOptions,
    });
  }

  private async sanitizeFlagsAsync(flags: RawBuildListFlags): Promise<BuildListCommandFlags> {
    return {
      ...flags,
      platform: maybeGetRequestedPlatform(flags.platform),
      status: maybeGetBuildStatus(flags.status),
      distribution: maybeGetBuildDistributionType(flags.distribution),
      'non-interactive': flags['non-interactive'] ?? false,
    };
  }
}

const toAppPlatform = (requestedPlatform?: RequestedPlatform): AppPlatform | undefined => {
  if (!requestedPlatform || requestedPlatform === RequestedPlatform.All) {
    return undefined;
  } else if (requestedPlatform === RequestedPlatform.Android) {
    return AppPlatform.Android;
  } else {
    return AppPlatform.Ios;
  }
};

const toGraphQLBuildStatus = (buildStatus?: BuildStatus): GraphQLBuildStatus | undefined => {
  if (!buildStatus) {
    return undefined;
  } else if (buildStatus === BuildStatus.NEW) {
    return GraphQLBuildStatus.New;
  } else if (buildStatus === BuildStatus.IN_QUEUE) {
    return GraphQLBuildStatus.InQueue;
  } else if (buildStatus === BuildStatus.IN_PROGRESS) {
    return GraphQLBuildStatus.InProgress;
  } else if (buildStatus === BuildStatus.PENDING_CANCEL) {
    return GraphQLBuildStatus.PendingCancel;
  } else if (buildStatus === BuildStatus.ERRORED) {
    return GraphQLBuildStatus.Errored;
  } else if (buildStatus === BuildStatus.FINISHED) {
    return GraphQLBuildStatus.Finished;
  } else {
    return GraphQLBuildStatus.Canceled;
  }
};
