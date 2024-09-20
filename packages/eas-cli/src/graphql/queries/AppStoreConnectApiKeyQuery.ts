import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../client';
import {
  AppStoreConnectApiKeyByIdQuery,
  AppStoreConnectApiKeyByIdQueryVariables,
} from '../generated';

export const AppStoreConnectApiKeyQuery = {
  async getByIdAsync(
    graphqlClient: ExpoGraphqlClient,
    ascApiKeyId: string
  ): Promise<{
    issuerIdentifier: string;
    keyIdentifier: string;
    keyP8: string;
  }> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<AppStoreConnectApiKeyByIdQuery, AppStoreConnectApiKeyByIdQueryVariables>(
          gql`
            query AppStoreConnectApiKeyById($ascApiKeyId: ID!) {
              appStoreConnectApiKey {
                byId(id: $ascApiKeyId) {
                  id
                  issuerIdentifier
                  keyIdentifier
                  keyP8
                }
              }
            }
          `,
          { ascApiKeyId },
          {
            additionalTypenames: ['AppStoreConnectApiKey'],
          }
        )
        .toPromise()
    );

    const key = data.appStoreConnectApiKey.byId;

    return {
      issuerIdentifier: key.issuerIdentifier,
      keyIdentifier: key.keyIdentifier,
      keyP8: key.keyP8,
    };
  },
};
