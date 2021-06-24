import { getConfig } from '@expo/config';
import { Command, flags } from '@oclif/command';
import chalk from 'chalk';
import ora from 'ora';

import { BuildStatus, RequestedPlatform } from '../../build/types';
import { formatGraphQLBuild } from '../../build/utils/formatBuild';
import { AppPlatform, BuildStatus as GraphQLBuildStatus } from '../../graphql/generated';
import { BuildQuery } from '../../graphql/queries/BuildQuery';
import Log from '../../log';
import {
  findProjectRootAsync,
  getProjectFullNameAsync,
  getProjectIdAsync,
} from '../../project/projectUtils';

export default class BuildList extends Command {
  static description = 'list all builds for your project';

  static flags = {
    platform: flags.enum({
      options: [RequestedPlatform.All, RequestedPlatform.Android, RequestedPlatform.Ios],
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
    limit: flags.integer(),
  };

  async run() {
    const { platform: requestedPlatform, status: buildStatus, limit = 10 } = this.parse(
      BuildList
    ).flags;

    const platform = toAppPlatform(requestedPlatform);
    const graphqlBuildStatus = toGraphQLBuildStatus(buildStatus);

    const projectDir = (await findProjectRootAsync()) ?? process.cwd();
    const { exp } = getConfig(projectDir, { skipSDKVersionRequirement: true });
    const projectId = await getProjectIdAsync(exp);
    const projectName = await getProjectFullNameAsync(exp);

    const spinner = ora().start('Fetching the build list for the project…');

    try {
      const builds = await BuildQuery.allForAppAsync(projectId, {
        limit,
        platform,
        status: graphqlBuildStatus,
      });

      if (builds.length) {
        if (platform || graphqlBuildStatus) {
          spinner.succeed(
            `Showing ${builds.length} matching builds for the project ${projectName}`
          );
        } else {
          spinner.succeed(`Showing last ${builds.length} builds for the project ${projectName}`);
        }

        const list = builds
          .map(build => formatGraphQLBuild(build))
          .join(`\n\n${chalk.dim('———')}\n\n`);

        Log.log(`\n${list}`);
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

const toGraphQLBuildStatus = (buildStatus: BuildStatus): GraphQLBuildStatus | undefined => {
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
