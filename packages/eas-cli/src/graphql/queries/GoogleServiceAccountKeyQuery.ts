import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../client';
import {
  GoogleServiceAccountKeyByIdQuery,
  GoogleServiceAccountKeyByIdQueryVariables,
} from '../generated';

export const GoogleServiceAccountKeyQuery = {
  async getByIdAsync(
    graphqlClient: ExpoGraphqlClient,
    ascApiKeyId: string
  ): Promise<{ keyJson: string } | null> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<GoogleServiceAccountKeyByIdQuery, GoogleServiceAccountKeyByIdQueryVariables>(
          gql`
            query GoogleServiceAccountKeyById($ascApiKeyId: ID!) {
              googleServiceAccountKey {
                byId(id: $ascApiKeyId) {
                  id
                  keyJson
                }
              }
            }
          `,
          { ascApiKeyId },
          {
            additionalTypenames: ['GoogleServiceAccountKey'],
          }
        )
        .toPromise()
    );

    const key = data.googleServiceAccountKey?.byId;

    if (!key) {
      return null;
    }

    return { keyJson: key.keyJson };
  },
};
