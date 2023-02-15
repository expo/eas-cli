import chalk from 'chalk';

import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { PaginatedQueryOptions } from '../commandUtils/pagination';
import { AppPlatform, BuildFilter, BuildFragment } from '../graphql/generated';
import { BuildQuery } from '../graphql/queries/BuildQuery';
import Log from '../log';
import { fromNow } from '../utils/date';
import { printJsonOnlyOutput } from '../utils/json';
import {
  paginatedQueryWithConfirmPromptAsync,
  paginatedQueryWithSelectPromptAsync,
} from '../utils/queries';
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

export async function listAndSelectBuildOnAppAsync(
  graphqlClient: ExpoGraphqlClient,
  {
    projectId,
    title,
    filter,
    paginatedQueryOptions,
    selectPromptDisabledFunction,
    selectPromptWarningMessage,
  }: {
    projectId: string;
    title: string;
    filter?: BuildFilter;
    paginatedQueryOptions: PaginatedQueryOptions;
    selectPromptDisabledFunction?: (build: BuildFragment) => boolean;
    selectPromptWarningMessage?: string;
  }
): Promise<BuildFragment | null> {
  if (paginatedQueryOptions.nonInteractive) {
    throw new Error('Unable to select a build in non-interactive mode.');
  } else {
    const selectedBuild = await paginatedQueryWithSelectPromptAsync({
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
        title,
        getIdentifierForQueryItem: build => build.id,
        makePartialChoiceObject: createBuildToPartialChoiceMaker(selectPromptDisabledFunction),
        selectPromptWarningMessage,
      },
    });
    return selectedBuild ?? null;
  }
}

function createBuildToPartialChoiceMaker(
  selectPromptDisabledFunction?: (build: BuildFragment) => boolean
) {
  return (
    build: BuildFragment
  ): {
    title: string;
    description: string;
    disabled?: boolean;
  } => {
    const splitCommitMessage = build.gitCommitMessage?.split('\n');
    const formattedCommitData =
      build.gitCommitHash && splitCommitMessage && splitCommitMessage.length > 0
        ? `${build.gitCommitHash.slice(0, 7)} "${chalk.bold(
            splitCommitMessage[0] + (splitCommitMessage.length > 1 ? '…' : '')
          )}"`
        : null;

    const descriptionItemNameToValue: Record<string, string | null> = {
      Version: build.appVersion ? chalk.bold(build.appVersion) : null,
      Commit: formattedCommitData,
      Message: build.message
        ? chalk.bold(
            build.message.length > 200 ? `${build.message.slice(0, 200)}...` : build.message
          )
        : null,
    };
    descriptionItemNameToValue[
      build.platform === AppPlatform.Ios ? 'Build number' : 'Version code'
    ] = build.appBuildVersion ? chalk.bold(build.appBuildVersion) : null;

    const descriptionItems = Object.keys(descriptionItemNameToValue)
      .filter(k => descriptionItemNameToValue[k])
      .map(k => `${chalk.bold(k)}: ${descriptionItemNameToValue[k]}`);

    return {
      title: `${chalk.bold(`ID:`)} ${build.id} (${chalk.bold(
        `${fromNow(new Date(build.completedAt))} ago`
      )})`,
      description: descriptionItems.length > 0 ? descriptionItems.join('\n') : '',
      disabled: selectPromptDisabledFunction?.(build),
    };
  };
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
): Promise<BuildFragment | null> {
  const builds = await BuildQuery.viewBuildsOnAppAsync(graphqlClient, {
    appId: projectId,
    limit: 1,
    offset: 0,
    filter,
  });

  if (builds.length === 0) {
    return null;
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
