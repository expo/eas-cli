import chalk from 'chalk';
import gql from 'graphql-tag';

import EasCommand from '../../commandUtils/EasCommand';
import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { EASNonInteractiveFlag } from '../../commandUtils/flags';
import { withErrorHandlingAsync } from '../../graphql/client';
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
import { getDisplayNameForProjectIdAsync } from '../../project/projectUtils';
import { confirmAsync, selectAsync } from '../../prompts';

async function cancelBuildAsync(
  graphqlClient: ExpoGraphqlClient,
  buildId: string
): Promise<Pick<Build, 'id' | 'status'>> {
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

export async function selectBuildToCancelAsync(
  graphqlClient: ExpoGraphqlClient,
  projectId: string,
  projectDisplayName: string
): Promise<string | null> {
  const spinner = ora().start('Fetching the uncompleted builds…');

  let builds;
  try {
    const [newBuilds, inQueueBuilds, inProgressBuilds] = await Promise.all([
      BuildQuery.viewBuildsOnAppAsync(graphqlClient, {
        appId: projectId,
        offset: 0,
        limit: 10,
        filter: { status: BuildStatus.New },
      }),
      BuildQuery.viewBuildsOnAppAsync(graphqlClient, {
        appId: projectId,
        offset: 0,
        limit: 10,
        filter: { status: BuildStatus.InQueue },
      }),
      BuildQuery.viewBuildsOnAppAsync(graphqlClient, {
        appId: projectId,
        offset: 0,
        limit: 10,
        filter: { status: BuildStatus.InProgress },
      }),
    ]);
    spinner.stop();
    builds = [...newBuilds, ...inQueueBuilds, ...inProgressBuilds];
  } catch (error) {
    spinner.fail(
      `Something went wrong and we couldn't fetch the builds for the project ${projectDisplayName}.`
    );
    throw error;
  }
  if (builds.length === 0) {
    Log.warn(`There aren't any uncompleted builds for the project ${projectDisplayName}.`);
    return null;
  } else {
    const buildId = await selectAsync<string>(
      'Which build do you want to cancel?',
      builds.map(build => ({
        title: formatUnfinishedBuild(build),
        value: build.id,
      }))
    );

    return (await confirmAsync({
      message: 'Are you sure you want to cancel it?',
    }))
      ? buildId
      : null;
  }
}

async function ensureBuildExistsAsync(
  graphqlClient: ExpoGraphqlClient,
  buildId: string
): Promise<void> {
  try {
    await BuildQuery.byIdAsync(graphqlClient, buildId);
  } catch {
    throw new Error(`Couldn't find a build matching the id ${buildId}`);
  }
}

export default class BuildCancel extends EasCommand {
  static override description = 'cancel a build';

  static override args = [{ name: 'BUILD_ID' }];

  static override flags = {
    ...EASNonInteractiveFlag,
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectConfig,
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const {
      args: { BUILD_ID: buildIdFromArg },
      flags: { 'non-interactive': nonInteractive },
    } = await this.parse(BuildCancel);
    const {
      projectConfig: { projectId },
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(BuildCancel, {
      nonInteractive,
    });

    const displayName = await getDisplayNameForProjectIdAsync(graphqlClient, projectId);

    if (buildIdFromArg) {
      await ensureBuildExistsAsync(graphqlClient, buildIdFromArg);
    }

    let buildId: string | null = buildIdFromArg;
    if (!buildId) {
      if (nonInteractive) {
        throw new Error('BUILD_ID must not be empty in non-interactive mode');
      }

      buildId = await selectBuildToCancelAsync(graphqlClient, projectId, displayName);
      if (!buildId) {
        return;
      }
    }

    const spinner = ora().start('Canceling the build…');
    try {
      const { status } = await cancelBuildAsync(graphqlClient, buildId);
      if ([BuildStatus.Canceled, BuildStatus.PendingCancel].includes(status)) {
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
