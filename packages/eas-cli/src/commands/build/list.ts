import { Flags } from '@oclif/core';
import chalk from 'chalk';

import { BuildDistributionType, BuildStatus } from '../../build/types';
import { formatGraphQLBuild } from '../../build/utils/formatBuild';
import EasCommand from '../../commandUtils/EasCommand';
import {
  AppPlatform,
  BuildFragment,
  DistributionType,
  BuildStatus as GraphQLBuildStatus,
} from '../../graphql/generated';
import { BuildQuery, BuildsQuery } from '../../graphql/queries/BuildQuery';
import Log from '../../log';
import { RequestedPlatform } from '../../platform';
import { getExpoConfig } from '../../project/expoConfig';
import {
  findProjectRootAsync,
  getProjectFullNameAsync,
  getProjectIdAsync,
} from '../../project/projectUtils';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';
import { PaginatedQueryResponse, performPaginatedQueryAsync } from '../../utils/queries';

export default class BuildList extends EasCommand {
  static description = 'list all builds for your project';

  static flags = {
    platform: Flags.enum({
      options: [RequestedPlatform.All, RequestedPlatform.Android, RequestedPlatform.Ios],
    }),
    json: Flags.boolean({
      description: 'Enable JSON output, non-JSON messages will be printed to stderr',
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
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(BuildList);
    const {
      json,
      platform: requestedPlatform,
      status: buildStatus,
      distribution: buildDistribution,
    } = flags;
    if (json) {
      enableJsonOutput();
    }

    const platform = toAppPlatform(requestedPlatform);
    const graphqlBuildStatus = toGraphQLBuildStatus(buildStatus);
    const graphqlBuildDistribution = toGraphQLBuildDistribution(buildDistribution);

    const projectDir = await findProjectRootAsync();
    const exp = getExpoConfig(projectDir);
    const projectId = await getProjectIdAsync(exp);
    const projectName = await getProjectFullNameAsync(exp);

    await queryForPaginatedBuildsAsync(
      projectId,
      projectName,
      {
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
      flags
    );
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

const toGraphQLBuildDistribution = (
  buildDistribution?: BuildDistributionType
): DistributionType | undefined => {
  if (buildDistribution === BuildDistributionType.STORE) {
    return DistributionType.Store;
  } else if (buildDistribution === BuildDistributionType.INTERNAL) {
    return DistributionType.Internal;
  } else if (buildDistribution === BuildDistributionType.SIMULATOR) {
    return DistributionType.Simulator;
  } else {
    return undefined;
  }
};

async function queryForPaginatedBuildsAsync(
  projectId: string,
  projectName: string,
  filter: BuildsQuery['filter'],
  flags: { json: boolean } & { json: boolean | undefined }
): Promise<void> {
  const queryAdditionalBuildsAsync = async (
    pageSize: number,
    offset: number
  ): Promise<PaginatedQueryResponse<BuildFragment>> => {
    const builds = await BuildQuery.allForAppAsync(projectId, {
      limit: pageSize,
      offset,
      filter,
    });

    return {
      queryResponse: builds,
      queryResponseRawLength: builds.length,
    };
  };

  const renderPageOfBuilds = (currentPage: BuildFragment[]): void => {
    if (flags.json) {
      printJsonOnlyOutput(currentPage);
    } else {
      if (currentPage.length) {
        const list = currentPage
          .map(build => formatGraphQLBuild(build))
          .join(`\n\n${chalk.dim('———')}\n\n`);

        Log.addNewLineIfNone();
        Log.withTick(chalk.bold(`Builds for ${projectName}:`));
        Log.log(`\n${list}`);
        Log.addNewLineIfNone();
      } else {
        Log.withCross(chalk.bold(`Couldn't find any builds for the project ${projectName}`));
        Log.addNewLineIfNone();
      }
    }
  };

  await performPaginatedQueryAsync({
    pageSize: 50,
    offset: 0,
    queryToPerform: queryAdditionalBuildsAsync,
    promptOptions: {
      type: 'confirm',
      title: 'Fetch next page of builds?',
      renderListItems: renderPageOfBuilds,
    },
  });
}
