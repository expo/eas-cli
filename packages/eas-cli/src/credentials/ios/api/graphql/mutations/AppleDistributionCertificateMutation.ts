import assert from 'assert';
import { print } from 'graphql';
import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../../../../../graphql/client';
import {
  AppleDistributionCertificateFragment,
  AppleTeamFragment,
  CreateAppleDistributionCertificateMutation,
} from '../../../../../graphql/generated';
import { AppleDistributionCertificateFragmentNode } from '../../../../../graphql/types/credentials/AppleDistributionCertificate';
import { AppleTeamFragmentNode } from '../../../../../graphql/types/credentials/AppleTeam';

export type AppleDistributionCertificateMutationResult = AppleDistributionCertificateFragment & {
  appleTeam?: AppleTeamFragment | null;
};

const AppleDistributionCertificateMutation = {
  async createAppleDistributionCertificate(
    appleDistributionCertificateInput: {
      certP12: string;
      certPassword: string;
      certPrivateSigningKey?: string;
      developerPortalIdentifier?: string;
      appleTeamId?: string;
    },
    accountId: string
  ): Promise<AppleDistributionCertificateMutationResult> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<CreateAppleDistributionCertificateMutation>(
          gql`
            mutation CreateAppleDistributionCertificateMutation(
              $appleDistributionCertificateInput: AppleDistributionCertificateInput!
              $accountId: ID!
            ) {
              appleDistributionCertificate {
                createAppleDistributionCertificate(
                  appleDistributionCertificateInput: $appleDistributionCertificateInput
                  accountId: $accountId
                ) {
                  id
                  ...AppleDistributionCertificateFragment
                  appleTeam {
                    id
                    ...AppleTeamFragment
                  }
                }
              }
            }
            ${print(AppleDistributionCertificateFragmentNode)}
            ${print(AppleTeamFragmentNode)}
          `,
          {
            appleDistributionCertificateInput,
            accountId,
          }
        )
        .toPromise()
    );
    assert(
      data.appleDistributionCertificate.createAppleDistributionCertificate,
      'GraphQL: `createAppleDistributionCertificate` not defined in server response'
    );
    return data.appleDistributionCertificate.createAppleDistributionCertificate;
  },
};

export { AppleDistributionCertificateMutation };
