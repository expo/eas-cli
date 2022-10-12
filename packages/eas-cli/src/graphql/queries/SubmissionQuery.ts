import { print } from 'graphql';
import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../client';
import {
  AppPlatform,
  GetAllSubmissionsForAppQuery,
  GetAllSubmissionsForAppQueryVariables,
  SubmissionFragment,
  SubmissionStatus,
  SubmissionsByIdQuery,
  SubmissionsByIdQueryVariables,
} from '../generated';
import { SubmissionFragmentNode } from '../types/Submission';

type Filters = {
  platform?: AppPlatform;
  status?: SubmissionStatus;
  offset?: number;
  limit?: number;
};

export const SubmissionQuery = {
  async byIdAsync(
    graphqlClient: ExpoGraphqlClient,
    submissionId: string,
    { useCache = true }: { useCache?: boolean } = {}
  ): Promise<SubmissionFragment> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<SubmissionsByIdQuery, SubmissionsByIdQueryVariables>(
          gql`
            query SubmissionsByIdQuery($submissionId: ID!) {
              submissions {
                byId(submissionId: $submissionId) {
                  id
                  ...SubmissionFragment
                }
              }
            }
            ${print(SubmissionFragmentNode)}
          `,
          { submissionId },
          {
            requestPolicy: useCache ? 'cache-first' : 'network-only',
            additionalTypenames: ['Submission'],
          }
        )
        .toPromise()
    );
    return data.submissions.byId;
  },

  async allForAppAsync(
    graphqlClient: ExpoGraphqlClient,
    appId: string,
    { limit = 10, offset = 0, status, platform }: Filters
  ): Promise<SubmissionFragment[]> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<GetAllSubmissionsForAppQuery, GetAllSubmissionsForAppQueryVariables>(
          gql`
            query GetAllSubmissionsForApp(
              $appId: String!
              $offset: Int!
              $limit: Int!
              $status: SubmissionStatus
              $platform: AppPlatform
            ) {
              app {
                byId(appId: $appId) {
                  id
                  submissions(
                    filter: { status: $status, platform: $platform }
                    offset: $offset
                    limit: $limit
                  ) {
                    id
                    ...SubmissionFragment
                  }
                }
              }
            }
            ${print(SubmissionFragmentNode)}
          `,
          { appId, offset, limit, status, platform },
          { additionalTypenames: ['Submission'] }
        )
        .toPromise()
    );

    return data.app?.byId.submissions ?? [];
  },
};
