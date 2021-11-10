import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../client';
import { CreateKeystoreGenerationUrlMutation } from '../generated';

export const KeystoreGenerationUrlMutation = {
  async createKeystoreGenerationUrlAsync(): Promise<string> {
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
          `
        )
        .toPromise()
    );
    return data.keystoreGenerationUrl.createKeystoreGenerationUrl.url;
  },
};
