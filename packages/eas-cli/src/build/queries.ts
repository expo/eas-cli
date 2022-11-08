import chalk from 'chalk';

import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { PaginatedQueryOptions } from '../commandUtils/pagination';
import { AppPlatform, BuildFilter, BuildFragment } from '../graphql/generated';
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

function formatBuildChoiceValue(value: string | undefined | null): string {
  return value ? chalk.bold(value) : chalk.dim('Unknown');
}

function formatBuildChoiceTitle(build: BuildFragment): string {
  const splittedCommitMessage = build.gitCommitMessage?.split('\n');
  const formattedCommitData =
    build.gitCommitHash && splittedCommitMessage && splittedCommitMessage.length > 0
      ? `${chalk.dim(build.gitCommitHash.slice(0, 7))} "${chalk.bold(
          splittedCommitMessage[0] + (splittedCommitMessage.length > 1 ? '…' : '')
        )}"`
      : 'Unknown';

  return [
    `ID: ${chalk.dim(build.id)}`,
    `\tVersion: ${formatBuildChoiceValue(build.appVersion)}`,
    `\t${
      build.platform === AppPlatform.Ios ? 'Build number' : 'Version code'
    }: ${formatBuildChoiceValue(build.appBuildVersion)}`,
    `\tCommit: ${formattedCommitData}`,
  ].join('\n');
}

export async function listAndSelectBuildsOnAppAsync(
  graphqlClient: ExpoGraphqlClient,
  {
    projectId,
    projectDisplayName,
    filter,
    queryOptions,
    selectPromptDisabledFunction,
    warningMessage,
  }: {
    projectId: string;
    projectDisplayName: string;
    filter?: BuildFilter;
    queryOptions: PaginatedQueryOptions;
    selectPromptDisabledFunction?: (build: BuildFragment) => boolean;
    warningMessage?: string;
  }
): Promise<BuildFragment> {
  const builds = await BuildQuery.viewBuildsOnAppAsync(graphqlClient, {
    appId: projectId,
    limit: queryOptions.limit ?? BUILDS_LIMIT,
    offset: queryOptions.offset,
    filter,
  });

  if (builds.length === 0) {
    throw new Error('Found no builds matching the provided criteria.');
  }

  const { selectedSimulatorBuild } = await promptAsync({
    type: 'select',
    message: `Select simulator build to run for ${projectDisplayName} app`,
    name: 'selectedSimulatorBuild',
    choices: builds.map(build => ({
      title: formatBuildChoiceTitle(build),
      value: build,
      disabled: selectPromptDisabledFunction?.(build),
    })),
    warn: warningMessage,
  });
  return selectedSimulatorBuild;
}

export async function getLatestBuildAsync(
  graphqlClient: ExpoGraphqlClient,
  {
    projectId,
    filter,
  }: {
    projectId: string;
    filter?: BuildFilter;
  }
): Promise<BuildFragment> {
  const builds = await BuildQuery.viewBuildsOnAppAsync(graphqlClient, {
    appId: projectId,
    limit: 1,
    offset: 0,
    filter,
  });

  if (builds.length === 0) {
    throw new Error('Found no build matching the provided criteria.');
  }

  return builds[0];
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
