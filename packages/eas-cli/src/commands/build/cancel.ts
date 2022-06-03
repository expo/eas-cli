import chalk from 'chalk';
import gql from 'graphql-tag';

import EasCommand from '../../commandUtils/EasCommand';
import { graphqlClient, withErrorHandlingAsync } from '../../graphql/client';
import {
  Build,
  BuildStatus,
  CancelBuildMutation,
  CancelBuildMutationVariables,
} from '../../graphql/generated';
import { BuildQuery } from '../../graphql/queries/BuildQuery';
import Log from '../../log';
import { ora } from '../../ora';
import { appPlatformEmojis } from '../../platform';
import { getExpoConfig } from '../../project/expoConfig';
import {
  findProjectRootAsync,
  getProjectFullNameAsync,
  getProjectIdAsync,
} from '../../project/projectUtils';
import { confirmAsync, selectAsync } from '../../prompts';

async function cancelBuildAsync(buildId: string): Promise<Pick<Build, 'id' | 'status'>> {
  const data = await withErrorHandlingAsync(
    graphqlClient
      .mutation<CancelBuildMutation, CancelBuildMutationVariables>(
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

function formatUnfinishedBuild(
  build: Pick<Build, 'id' | 'platform' | 'status' | 'createdAt'>
): string {
  const platform = appPlatformEmojis[build.platform];
  const startTime = new Date(build.createdAt).toLocaleString();
  let statusText: string;
  if (build.status === BuildStatus.New) {
    statusText = 'new';
  } else if (build.status === BuildStatus.InQueue) {
    statusText = 'in queue';
  } else {
    statusText = 'in progress';
  }
  const status = chalk.blue(statusText);
  return `${platform} Started at: ${startTime}, Status: ${status}, Id: ${build.id}`;
}

async function selectBuildToCancelAsync(
  projectId: string,
  projectFullName: string
): Promise<string | null> {
  const spinner = ora().start('Fetching the uncompleted builds…');
  let builds;
  try {
    const [newBuilds, inQueueBuilds, inProgressBuilds] = await Promise.all([
      BuildQuery.allForAppAsync(projectId, { filter: { status: BuildStatus.New } }),
      BuildQuery.allForAppAsync(projectId, { filter: { status: BuildStatus.InQueue } }),
      BuildQuery.allForAppAsync(projectId, { filter: { status: BuildStatus.InProgress } }),
    ]);
    spinner.stop();
    builds = [...newBuilds, ...inQueueBuilds, ...inProgressBuilds];
  } catch (error) {
    spinner.fail(
      `Something went wrong and we couldn't fetch the builds for the project ${projectFullName}.`
    );
    throw error;
  }
  if (builds.length === 0) {
    Log.warn(`There aren't any uncompleted builds for the project ${projectFullName}.`);
    return null;
  } else if (builds.length === 1) {
    Log.log('Found one build');
    Log.log(formatUnfinishedBuild(builds[0]));
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
    return buildId;
  }
}

async function ensureBuildExistsAsync(buildId: string): Promise<void> {
  try {
    await BuildQuery.byIdAsync(buildId);
  } catch {
    throw new Error(`Couldn't find a build matching the id ${buildId}`);
  }
}

export default class BuildCancel extends EasCommand {
  static description = 'cancel a build';

  static args = [{ name: 'BUILD_ID' }];

  async runAsync(): Promise<void> {
    const { BUILD_ID: buildIdFromArg } = (await this.parse(BuildCancel)).args;

    const projectDir = await findProjectRootAsync();
    const exp = getExpoConfig(projectDir);
    const projectId = await getProjectIdAsync(exp);
    const projectFullName = await getProjectFullNameAsync(exp);

    if (buildIdFromArg) {
      await ensureBuildExistsAsync(buildIdFromArg);
    }

    const buildId = buildIdFromArg || (await selectBuildToCancelAsync(projectId, projectFullName));
    if (!buildId) {
      return;
    }

    const spinner = ora().start('Canceling the build…');
    try {
      const { status } = await cancelBuildAsync(buildId);
      if (status === BuildStatus.Canceled) {
        spinner.succeed('Build canceled');
      } else {
        spinner.text = 'Build is already completed';
        spinner.stopAndPersist();
      }
    } catch (error) {
      spinner.fail(`Something went wrong and we couldn't cancel your build ${buildId}`);
      throw error;
    }
  }
}
