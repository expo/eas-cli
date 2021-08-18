import { getConfig } from '@expo/config';
import { Command, flags } from '@oclif/command';
import chalk from 'chalk';
import ora from 'ora';

import { BuildDistributionType, BuildStatus, RequestedPlatform } from '../../build/types';
import { formatGraphQLBuild } from '../../build/utils/formatBuild';
import {
  AppPlatform,
  DistributionType,
  BuildStatus as GraphQLBuildStatus,
} from '../../graphql/generated';
import { BuildQuery } from '../../graphql/queries/BuildQuery';
import Log from '../../log';
import {
  findProjectRootAsync,
  getProjectFullNameAsync,
  getProjectIdAsync,
} from '../../project/projectUtils';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

export default class BuildList extends Command {
  static description = 'list all builds for your project';

  static flags = {
    platform: flags.enum({
      options: [RequestedPlatform.All, RequestedPlatform.Android, RequestedPlatform.Ios],
    }),
    json: flags.boolean({
      description: 'Enable json output, non-json messages will printed to stderr',
    }),
    status: flags.enum({
      options: [
        BuildStatus.NEW,
        BuildStatus.IN_QUEUE,
        BuildStatus.IN_PROGRESS,
        BuildStatus.ERRORED,
        BuildStatus.FINISHED,
        BuildStatus.CANCELED,
      ],
    }),
    distribution: flags.enum({
      options: [
        BuildDistributionType.STORE,
        BuildDistributionType.INTERNAL,
        BuildDistributionType.SIMULATOR,
      ],
    }),
    channel: flags.string(),
    appVersion: flags.string(),
    appBuildVersion: flags.string(),
    sdkVersion: flags.string(),
    runtimeVersion: flags.string(),
    appIdentifier: flags.string(),
    buildProfile: flags.string(),
    gitCommitHash: flags.string(),
    limit: flags.integer(),
  };

  async run() {
    const { flags } = this.parse(BuildList);
    const {
      json,
      platform: requestedPlatform,
      status: buildStatus,
      distribution: buildDistribution,
      limit = 10,
    } = flags;
    if (json) {
      enableJsonOutput();
    }

    const platform = toAppPlatform(requestedPlatform);
    const graphqlBuildStatus = toGraphQLBuildStatus(buildStatus);
    const graphqlBuildDistribution = toGraphQLBuildDistribution(buildDistribution);

    const projectDir = (await findProjectRootAsync()) ?? process.cwd();
    const { exp } = getConfig(projectDir, { skipSDKVersionRequirement: true });
    const projectId = await getProjectIdAsync(exp);
    const projectName = await getProjectFullNameAsync(exp);

    const spinner = ora().start('Fetching the build list for the project…');

    try {
      const builds = await BuildQuery.allForAppAsync(projectId, {
        limit,
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
      });

      if (builds.length) {
        if (platform || graphqlBuildStatus) {
          spinner.succeed(
            `Showing ${builds.length} matching builds for the project ${projectName}`
          );
        } else {
          spinner.succeed(`Showing last ${builds.length} builds for the project ${projectName}`);
        }

        if (json) {
          printJsonOnlyOutput(builds);
        } else {
          const list = builds
            .map(build => formatGraphQLBuild(build))
            .join(`\n\n${chalk.dim('———')}\n\n`);

          Log.log(`\n${list}`);
        }
      } else {
        spinner.fail(`Couldn't find any builds for the project ${projectName}`);
      }
    } catch (e) {
      spinner.fail(`Something went wrong and we couldn't fetch the build list ${projectName}`);
      throw e;
    }
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
