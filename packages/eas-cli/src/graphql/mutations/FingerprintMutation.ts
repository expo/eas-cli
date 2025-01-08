import { FingerprintSource } from '@expo/eas-build-job';
import { print } from 'graphql';
import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../client';
import { CreateFingeprintMutation, FingerprintFragment } from '../generated';
import { FingerprintFragmentNode } from '../types/Fingerprint';

export const FingerprintMutation = {
  async createFingerprintAsync(
    graphqlClient: ExpoGraphqlClient,
    appId: string,
    fingerprintData: { hash: string; source?: FingerprintSource }
  ): Promise<FingerprintFragment> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<CreateFingeprintMutation>(
          gql`
            mutation CreateFingeprintMutation(
              $fingerprintData: CreateFingerprintInput!
              $appId: ID!
            ) {
              fingerprint {
                createOrGetExistingFingerprint(fingerprintData: $fingerprintData, appId: $appId) {
                  id
                  ...FingerprintFragment
                }
              }
            }
            ${print(FingerprintFragmentNode)}
          `,
          { appId, fingerprintData }
        )
        .toPromise()
    );
    return data.fingerprint.createOrGetExistingFingerprint;
  },
};
