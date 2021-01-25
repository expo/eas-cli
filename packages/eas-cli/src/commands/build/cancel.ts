import { Command } from '@oclif/command';
import chalk from 'chalk';
import gql from 'graphql-tag';
import ora from 'ora';

import { platformEmojis } from '../../build/constants';
import { Platform } from '../../build/types';
import { graphqlClient, withErrorHandlingAsync } from '../../graphql/client';
import { AppPlatform, Build, BuildStatus } from '../../graphql/generated';
import { BuildQuery } from '../../graphql/queries/BuildQuery';
import log from '../../log';
import {
  findProjectRootAsync,
  getProjectFullNameAsync,
  getProjectIdAsync,
} from '../../project/projectUtils';
import { confirmAsync, selectAsync } from '../../prompts';

async function cancelBuildAsync(buildId: string): Promise<Pick<Build, 'id' | 'status'>> {
  const data = await withErrorHandlingAsync(
    graphqlClient
      .mutation<{ build: { cancel: { id: string; status: BuildStatus } } }>(
        gql`
          mutation CancelBuildMutation($buildId: ID!) {
            build(buildId: $buildId) {
              cancel {
                id
                status
              }
            }
          }
        `,
        { buildId }
      )
      .toPromise()
  );
  return data.build!.cancel;
}

const appPlatformMap = {
  [AppPlatform.Android]: Platform.Android,
  [AppPlatform.Ios]: Platform.iOS,
};

function formatUnfinishedBuild(
  build: Pick<Build, 'id' | 'platform' | 'status' | 'createdAt'>
): string {
  const platform = platformEmojis[appPlatformMap[build.platform]];
  const startTime = new Date(build.createdAt).toLocaleString();
  const status = chalk.blue(build.status === BuildStatus.InQueue ? 'in-queue' : 'in-progress');
  return `${platform} Started at: ${startTime}, Status: ${status}, Id: ${build.id}`;
}

async function selectBuildToCancelAsync(
  projectId: string,
  fullProjectName: string
): Promise<string | null> {
  const spinner = ora().start('Fetching the unfinished builds…');
  let builds;
  try {
    const [inQueueBuilds, inProgressBuilds] = await Promise.all([
      BuildQuery.allForAppAsync(projectId, { status: BuildStatus.InQueue }),
      BuildQuery.allForAppAsync(projectId, { status: BuildStatus.InProgress }),
    ]);
    spinner.stop();
    builds = [...inQueueBuilds, ...inProgressBuilds];
  } catch (error) {
    spinner.fail(
      `Something went wrong and we couldn't fetch the builds for the project ${fullProjectName}.`
    );
    throw error;
  }
  if (builds.length === 0) {
    log.warn(`There are no unfinished builds for the project ${fullProjectName}.`);
    return null;
  } else if (builds.length === 1) {
    log('Found one build');
    log(formatUnfinishedBuild(builds[0]));
    await confirmAsync({
      message: 'Do you want to cancel it?',
    });
    return builds[0].id;
  } else {
    const buildId = await selectAsync<string>(
      'Which build do you want to cancel?',
      builds.map(build => ({
        title: formatUnfinishedBuild(build),
        value: build.id,
      }))
    );
    log(buildId);
    return buildId;
  }
}

export default class BuildCancel extends Command {
  static description = 'cancel an unfinished build';

  static args = [{ name: 'BUILD_ID' }];

  async run() {
    const { buildId: buildIdFromArg } = this.parse(BuildCancel).args;

    const projectDir = (await findProjectRootAsync()) ?? process.cwd();
    const projectId = await getProjectIdAsync(projectDir);
    const fullProjectName = await getProjectFullNameAsync(projectDir);

    const buildId = buildIdFromArg || (await selectBuildToCancelAsync(projectId, fullProjectName));
    if (!buildId) {
      return;
    }

    const spinner = ora().start('Canceling the build…');
    try {
      const { status } = await cancelBuildAsync(buildId);
      if (status === BuildStatus.Canceled) {
        spinner.succeed('Build canceled');
      } else {
        spinner.text = 'Build already finished';
        spinner.stopAndPersist();
      }
    } catch (error) {
      spinner.fail(
        `Something went wrong and we couldn't fetch the last build for the project ${fullProjectName}`
      );
      throw error;
    }
  }
}
