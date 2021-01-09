import { print } from 'graphql';
import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../../../../../graphql/client';
import { AppleDistributionCertificate } from '../../../../../graphql/generated';
import { AppleDistributionCertificateFragmentDoc } from '../../../../../graphql/types/credentials/AppleDistributionCertificate';
import { AppleTeamFragmentDoc } from '../../../../../graphql/types/credentials/AppleTeam';

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
  ): Promise<AppleDistributionCertificate> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<{
          appleDistributionCertificate: {
            createAppleDistributionCertificate: AppleDistributionCertificate;
          };
        }>(
          gql`
            mutation AppleDistributionCertificateMutation(
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
            ${print(AppleDistributionCertificateFragmentDoc)}
            ${print(AppleTeamFragmentDoc)}
          `,
          {
            appleDistributionCertificateInput,
            accountId,
          }
        )
        .toPromise()
    );
    return data.appleDistributionCertificate.createAppleDistributionCertificate;
  },
};

export { AppleDistributionCertificateMutation };
