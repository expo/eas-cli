import chalk from 'chalk';
import gql from 'graphql-tag';

import EasCommand from '../../commandUtils/EasCommand';
import { graphqlClient, withErrorHandlingAsync } from '../../graphql/client';
import {
  Build,
  BuildFragment,
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
import { confirmAsync } from '../../prompts';
import { PaginatedQueryResponse, performPaginatedQueryAsync } from '../../utils/queries';

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

    const buildId =
      buildIdFromArg || (await queryForBuildToCancelAsync(projectId, projectFullName));
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

async function queryForBuildToCancelAsync(
  projectId: string,
  projectFullName: string
): Promise<string | null> {
  const queryToPerformAsync = async (
    pageSize: number,
    offset: number
  ): Promise<PaginatedQueryResponse<BuildFragment>> => {
    const [newBuilds, inQueueBuilds, inProgressBuilds] = await Promise.all([
      BuildQuery.allForAppAsync(projectId, {
        limit: pageSize,
        offset,
        filter: { status: BuildStatus.New },
      }),
      BuildQuery.allForAppAsync(projectId, {
        limit: pageSize,
        offset,
        filter: { status: BuildStatus.InQueue },
      }),
      BuildQuery.allForAppAsync(projectId, {
        limit: pageSize,
        offset,
        filter: { status: BuildStatus.InProgress },
      }),
    ]);

    // this variable controls whether performPaginatedQueryAsync will query the next page.
    // force another query if we have hit the query limit for any of these 3 queries.
    const queryResponseLength =
      newBuilds.length < pageSize &&
      inQueueBuilds.length < pageSize &&
      inProgressBuilds.length < pageSize
        ? pageSize - 1
        : pageSize;

    return {
      queryResponse: [...newBuilds, ...inQueueBuilds, ...inProgressBuilds],
      queryResponseRawLength: queryResponseLength,
    };
  };
  const getIdentifierForQueryItem = (buildFragment: BuildFragment): string => buildFragment.id;
  const selectedBuild = (
    await performPaginatedQueryAsync({
      pageSize: 50,
      offset: 0,
      queryToPerform: queryToPerformAsync,
      promptOptions: {
        type: 'select',
        title: 'Which build would you like to cancel?',
        getIdentifierForQueryItem,
        createDisplayTextForSelectionPromptListItem: formatUnfinishedBuild,
      },
    })
  ).pop();

  if (!selectedBuild) {
    Log.warn(`There aren't any uncompleted builds for the project ${projectFullName}.`);
    return null;
  }

  const userConfirmedCancellation = await confirmAsync({
    message: `Are you sure you want to cancel ${formatUnfinishedBuild(selectedBuild)}?`,
  });
  return userConfirmedCancellation ? selectedBuild.id : null;
}
