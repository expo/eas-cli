import chalk from 'chalk';

import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { PaginatedQueryOptions } from '../commandUtils/pagination';
import { BuildFilter, BuildFragment } from '../graphql/generated';
import { BuildQuery } from '../graphql/queries/BuildQuery';
import Log from '../log';
import { promptAsync } from '../prompts';
import { printJsonOnlyOutput } from '../utils/json';
import { paginatedQueryWithConfirmPromptAsync } from '../utils/queries';
import { formatGraphQLBuild } from './utils/formatBuild';

export const BUILDS_LIMIT = 50;

export async function listAndRenderBuildsOnAppAsync(
  graphqlClient: ExpoGraphqlClient,
  {
    projectId,
    projectDisplayName,
    filter,
    paginatedQueryOptions,
  }: {
    projectId: string;
    projectDisplayName: string;
    filter?: BuildFilter;
    paginatedQueryOptions: PaginatedQueryOptions;
  }
): Promise<void> {
  if (paginatedQueryOptions.nonInteractive) {
    const builds = await BuildQuery.viewBuildsOnAppAsync(graphqlClient, {
      appId: projectId,
      limit: paginatedQueryOptions.limit ?? BUILDS_LIMIT,
      offset: paginatedQueryOptions.offset,
      filter,
    });
    renderPageOfBuilds({ builds, projectDisplayName, paginatedQueryOptions });
  } else {
    await paginatedQueryWithConfirmPromptAsync({
      limit: paginatedQueryOptions.limit ?? BUILDS_LIMIT,
      offset: paginatedQueryOptions.offset,
      queryToPerform: (limit, offset) =>
        BuildQuery.viewBuildsOnAppAsync(graphqlClient, {
          appId: projectId,
          limit,
          offset,
          filter,
        }),
      promptOptions: {
        title: 'Load more builds?',
        renderListItems: builds =>
          renderPageOfBuilds({ builds, projectDisplayName, paginatedQueryOptions }),
      },
    });
  }
}

export async function listAndSelectBuildsOnAppAsync(
  graphqlClient: ExpoGraphqlClient,
  {
    projectId,
    projectDisplayName,
    filter,
    paginatedQueryOptions,
  }: {
    projectId: string;
    projectDisplayName: string;
    filter?: BuildFilter;
    paginatedQueryOptions: PaginatedQueryOptions;
  }
): Promise<string> {
  const builds = await BuildQuery.viewBuildsOnAppAsync(graphqlClient, {
    appId: projectId,
    limit: paginatedQueryOptions.limit ?? BUILDS_LIMIT,
    offset: paginatedQueryOptions.offset,
    filter,
  });

  if (builds.length === 0) {
    throw new Error('No simulator builds found for given criteria.');
  }

  const { selectedSimulatorBuildId } = await promptAsync({
    type: 'select',
    message: `Select simulator build to run for ${projectDisplayName} app`,
    name: 'selectedSimulatorBuildId',
    choices: builds.map(build => ({
      title: `id: ${build.id}, platform: ${build.platform}, appVersion: ${build.appVersion}, appBuildVersion: ${build.appBuildVersion}`,
      value: build.id,
    })),
  });
  return selectedSimulatorBuildId;
}

function renderPageOfBuilds({
  builds,
  projectDisplayName,
  paginatedQueryOptions,
}: {
  builds: BuildFragment[];
  projectDisplayName: string;
  paginatedQueryOptions: PaginatedQueryOptions;
}): void {
  if (paginatedQueryOptions.json) {
    printJsonOnlyOutput(builds);
  } else {
    const list = builds.map(build => formatGraphQLBuild(build)).join(`\n\n${chalk.dim('———')}\n\n`);

    Log.addNewLineIfNone();
    Log.log(chalk.bold(`Builds for ${projectDisplayName}:`));
    Log.log(`\n${list}`);
  }
}
