import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../client';
import { UserPreferenceByKeyQuery, UserPreferenceByKeyQueryVariables } from '../generated';

export const UserPreferenceQuery = {
  /**
   * Returns the JSON value stored under the key for the current user, or null when the key is not
   * set or the viewer is not a user (for example a robot).
   */
  async getValueAsync(graphqlClient: ExpoGraphqlClient, key: string): Promise<unknown> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<UserPreferenceByKeyQuery, UserPreferenceByKeyQueryVariables>(
          gql`
            query UserPreferenceByKey($key: String!) {
              userPreference {
                get(key: $key) {
                  id
                  key
                  value
                }
              }
            }
          `,
          { key },
          { additionalTypenames: ['UserPreference'] }
        )
        .toPromise()
    );
    return data.userPreference.get?.value ?? null;
  },
};
