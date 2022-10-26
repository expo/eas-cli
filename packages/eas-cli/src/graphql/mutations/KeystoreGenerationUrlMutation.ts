import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../client';
import { CreateKeystoreGenerationUrlMutation } from '../generated';

export const KeystoreGenerationUrlMutation = {
  async createKeystoreGenerationUrlAsync(graphqlClient: ExpoGraphqlClient): Promise<string> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<CreateKeystoreGenerationUrlMutation>(
          gql`
            mutation CreateKeystoreGenerationUrlMutation {
              keystoreGenerationUrl {
                createKeystoreGenerationUrl {
                  id
                  url
                }
              }
            }
          `,
          {}
        )
        .toPromise()
    );
    return data.keystoreGenerationUrl.createKeystoreGenerationUrl.url;
  },
};
