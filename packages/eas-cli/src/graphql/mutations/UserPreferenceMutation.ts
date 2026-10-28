import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../client';
import { SetUserPreferenceMutation, SetUserPreferenceMutationVariables } from '../generated';

export const UserPreferenceMutation = {
  /** Stores the JSON value under the key for the current user. Rejects for robot viewers. */
  async setAsync(graphqlClient: ExpoGraphqlClient, key: string, value: unknown): Promise<void> {
    await withErrorHandlingAsync(
      graphqlClient
        .mutation<SetUserPreferenceMutation, SetUserPreferenceMutationVariables>(
          gql`
            mutation SetUserPreference($key: String!, $value: JSON!) {
              userPreference {
                set(key: $key, value: $value) {
                  id
                  key
                  value
                }
              }
            }
          `,
          { key, value },
          { additionalTypenames: ['UserPreference'], noRetry: true }
        )
        .toPromise()
    );
  },
};
