import gql from 'graphql-tag';

import EasCommand from '../../commandUtils/EasCommand';
import { ensureBuildExistsAsync, fetchBuildsAsync, formatBuild } from '../../commandUtils/builds';
import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { EASNonInteractiveFlag } from '../../commandUtils/flags';
import { withErrorHandlingAsync } from '../../graphql/client';
import { Build, DeleteBuildMutation, DeleteBuildMutationVariables } from '../../graphql/generated';
import Log from '../../log';
import { ora } from '../../ora';
import { getDisplayNameForProjectIdAsync } from '../../project/projectUtils';
import { confirmAsync, selectAsync } from '../../prompts';

async function deleteBuildAsync(
  graphqlClient: ExpoGraphqlClient,
  buildId: string
): Promise<Pick<Build, 'id'>> {
  const data = await withErrorHandlingAsync(
    graphqlClient
      .mutation<DeleteBuildMutation, DeleteBuildMutationVariables>(
        gql`
          mutation DeleteBuildMutation($buildId: ID!) {
            build(buildId: $buildId) {
              deleteBuild(buildId: $buildId) {
                id
              }
            }
          }
        `,
        { buildId }
      )
      .toPromise()
  );
  return data.build!.deleteBuild;
}

export async function selectBuildToDeleteAsync(
  graphqlClient: ExpoGraphqlClient,
  projectId: string,
  projectDisplayName: string
): Promise<string | null> {
  const spinner = ora().start('Fetching builds…');

  let builds;
  try {
    builds = await fetchBuildsAsync(graphqlClient, projectId);
    spinner.stop();
  } catch (error) {
    spinner.fail(
      `Something went wrong and we couldn't fetch the builds for the project ${projectDisplayName}.`
    );
    throw error;
  }
  if (builds.length === 0) {
    Log.warn(`There aren't any builds for the project ${projectDisplayName}.`);
    return null;
  } else {
    const buildId = await selectAsync<string>(
      'Which build do you want to delete?',
      builds.map(build => ({
        title: formatBuild(build),
        value: build.id,
      }))
    );

    return (await confirmAsync({
      message: 'Are you sure you want to delete it?',
    }))
      ? buildId
      : null;
  }
}

export default class BuildDelete extends EasCommand {
  static override description = 'delete a build';
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
    } = await this.parse(BuildDelete);
    const {
      privateProjectConfig: { projectId },
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(BuildDelete, { nonInteractive });
    const displayName = await getDisplayNameForProjectIdAsync(graphqlClient, projectId);

    if (buildIdFromArg) {
      await ensureBuildExistsAsync(graphqlClient, buildIdFromArg);
    }

    let buildId: string | null = buildIdFromArg;
    if (!buildId) {
      if (nonInteractive) {
        throw new Error('BUILD_ID must not be empty in non-interactive mode');
      }

      buildId = await selectBuildToDeleteAsync(graphqlClient, projectId, displayName);
      if (!buildId) {
        return;
      }
    }

    const spinner = ora().start('Deleting the build...');
    try {
      await deleteBuildAsync(graphqlClient, buildId);
      spinner.succeed('Build deleted');
    } catch (error) {
      spinner.fail(`Something went wrong and we couldn't delete your build ${buildId}`);
      throw error;
    }
  }
}
