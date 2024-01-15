import gql from 'graphql-tag';

import EasCommand from '../../commandUtils/EasCommand';
import { ensureBuildExistsAsync, fetchBuildsAsync, formatBuild } from '../../commandUtils/builds';
import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { EASNonInteractiveFlag } from '../../commandUtils/flags';
import { withErrorHandlingAsync } from '../../graphql/client';
import {
  Build,
  BuildStatus,
  CancelBuildMutation,
  CancelBuildMutationVariables,
} from '../../graphql/generated';
import Log from '../../log';
import { ora } from '../../ora';
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

export async function selectBuildToCancelAsync(
  graphqlClient: ExpoGraphqlClient,
  projectId: string,
  projectDisplayName: string
): Promise<string | null> {
  const spinner = ora().start('Fetching the uncompleted builds…');

  let builds;
  try {
    builds = await fetchBuildsAsync({
      graphqlClient,
      projectId,
      statuses: [BuildStatus.New, BuildStatus.InQueue, BuildStatus.InProgress],
    });
    spinner.stop();
  } catch (error) {
    spinner.fail(
      `Something went wrong and we couldn't fetch the builds for the project ${projectDisplayName}.`
    );
    throw error;
  }
  if (builds.length === 0) {
    Log.warn(`We couldn't find any uncompleted builds for the project ${projectDisplayName}.`);
    return null;
  } else {
    const buildId = await selectAsync<string>(
      'Which build do you want to cancel?',
      builds.map(build => ({
        title: formatBuild(build),
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

export default class BuildCancel extends EasCommand {
  static override description = 'cancel a build';

  static override args = [{ name: 'BUILD_ID' }];

  static override flags = {
    ...EASNonInteractiveFlag,
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectConfig,
    ...this.ContextOptions.LoggedIn,
    ...this.ContextOptions.Vcs,
  };

  async runAsync(): Promise<void> {
    const {
      args: { BUILD_ID: buildIdFromArg },
      flags: { 'non-interactive': nonInteractive },
    } = await this.parse(BuildCancel);
    const {
      privateProjectConfig: { projectId },
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
        throw new Error('Build ID must be provided in non-interactive mode');
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
