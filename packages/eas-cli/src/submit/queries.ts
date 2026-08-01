import chalk from 'chalk';

import { formatGraphQLSubmission } from './utils/formatSubmission';
import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { PaginatedQueryOptions } from '../commandUtils/pagination';
import {
  AppPlatform,
  SubmissionStatus,
  SubmissionWithSubmittedBuildFragment,
} from '../graphql/generated';
import { SubmissionQuery } from '../graphql/queries/SubmissionQuery';
import Log from '../log';
import { appPlatformDisplayNames } from '../platform';
import { fromNow } from '../utils/date';
import { printJsonOnlyOutput } from '../utils/json';
import { paginatedQueryWithConfirmPromptAsync } from '../utils/queries';

export const SUBMISSIONS_LIMIT = 50;

export type SubmissionFilter = {
  platform?: AppPlatform;
  status?: SubmissionStatus;
};

export async function listAndRenderSubmissionsOnAppAsync(
  graphqlClient: ExpoGraphqlClient,
  {
    projectId,
    projectDisplayName,
    filter,
    paginatedQueryOptions,
  }: {
    projectId: string;
    projectDisplayName: string;
    filter?: SubmissionFilter;
    paginatedQueryOptions: PaginatedQueryOptions;
  }
): Promise<void> {
  if (paginatedQueryOptions.nonInteractive) {
    const submissions = await SubmissionQuery.allForAppAsync(graphqlClient, projectId, {
      limit: paginatedQueryOptions.limit ?? SUBMISSIONS_LIMIT,
      offset: paginatedQueryOptions.offset,
      ...filter,
    });
    renderPageOfSubmissions({ submissions, projectDisplayName, paginatedQueryOptions });
  } else {
    await paginatedQueryWithConfirmPromptAsync({
      limit: paginatedQueryOptions.limit ?? SUBMISSIONS_LIMIT,
      offset: paginatedQueryOptions.offset,
      queryToPerform: (limit, offset) =>
        SubmissionQuery.allForAppAsync(graphqlClient, projectId, {
          limit,
          offset,
          ...filter,
        }),
      promptOptions: {
        title: 'Load more submissions?',
        renderListItems: submissions => {
          renderPageOfSubmissions({ submissions, projectDisplayName, paginatedQueryOptions });
        },
      },
    });
  }
}

export async function getLatestSubmissionAsync(
  graphqlClient: ExpoGraphqlClient,
  {
    projectId,
    filter,
  }: {
    projectId: string;
    filter?: SubmissionFilter;
  }
): Promise<SubmissionWithSubmittedBuildFragment | null> {
  const submissions = await SubmissionQuery.allForAppAsync(graphqlClient, projectId, {
    limit: 1,
    offset: 0,
    ...filter,
  });
  return submissions[0] ?? null;
}

export async function getRecentSubmissionsAsync(
  graphqlClient: ExpoGraphqlClient,
  {
    projectId,
    filter,
    limit = SUBMISSIONS_LIMIT,
  }: {
    projectId: string;
    filter?: SubmissionFilter;
    limit?: number;
  }
): Promise<SubmissionWithSubmittedBuildFragment[]> {
  return await SubmissionQuery.allForAppAsync(graphqlClient, projectId, {
    limit,
    offset: 0,
    ...filter,
  });
}

export function formatSubmissionChoice(submission: SubmissionWithSubmittedBuildFragment): string {
  const platform = appPlatformDisplayNames[submission.platform];
  const status = submission.status.toLowerCase().replace(/_/g, ' ');
  return `${platform} submission ${submission.id} (${status}, created ${fromNow(
    new Date(submission.createdAt)
  )} ago)`;
}

function renderPageOfSubmissions({
  submissions,
  projectDisplayName,
  paginatedQueryOptions,
}: {
  submissions: SubmissionWithSubmittedBuildFragment[];
  projectDisplayName: string;
  paginatedQueryOptions: PaginatedQueryOptions;
}): void {
  if (paginatedQueryOptions.json) {
    printJsonOnlyOutput(submissions);
  } else {
    const list = submissions
      .map(submission => formatGraphQLSubmission(submission))
      .join(`\n\n${chalk.dim('———')}\n\n`);

    Log.addNewLineIfNone();
    Log.log(chalk.bold(`Submissions for ${projectDisplayName}:`));
    Log.log(`\n${list}`);
  }
}
