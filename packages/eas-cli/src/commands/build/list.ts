import { Flags } from '@oclif/core';

import { BUILDS_LIMIT, listAndRenderBuildsOnAppAsync } from '../../build/queries';
import { BuildDistributionType, BuildStatus } from '../../build/types';
import EasCommand from '../../commandUtils/EasCommand';
import { EasNonInteractiveAndJsonFlags } from '../../commandUtils/flags';
import {
  EasPaginatedQueryFlags,
  getLimitFlagWithCustomValues,
  getPaginatedQueryOptions,
} from '../../commandUtils/pagination';
import { AppPlatform, BuildStatus as GraphQLBuildStatus } from '../../graphql/generated';
import { RequestedPlatform } from '../../platform';
import { getDisplayNameForProjectIdAsync } from '../../project/projectUtils';
import { buildDistributionTypeToGraphQLDistributionType } from '../../utils/buildDistribution';
import { enableJsonOutput } from '../../utils/json';

export default class BuildList extends EasCommand {
  static override description = 'list all builds for your project';

  static override flags = {
    platform: Flags.enum({
      options: [RequestedPlatform.All, RequestedPlatform.Android, RequestedPlatform.Ios],
    }),
    status: Flags.enum({
      options: [
        BuildStatus.NEW,
        BuildStatus.IN_QUEUE,
        BuildStatus.IN_PROGRESS,
        BuildStatus.ERRORED,
        BuildStatus.FINISHED,
        BuildStatus.CANCELED,
      ],
    }),
    distribution: Flags.enum({
      options: [
        BuildDistributionType.STORE,
        BuildDistributionType.INTERNAL,
        BuildDistributionType.SIMULATOR,
      ],
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
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(BuildList);
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
  } else if (buildStatus === BuildStatus.ERRORED) {
    return GraphQLBuildStatus.Errored;
  } else if (buildStatus === BuildStatus.FINISHED) {
    return GraphQLBuildStatus.Finished;
  } else {
    return GraphQLBuildStatus.Canceled;
  }
};
