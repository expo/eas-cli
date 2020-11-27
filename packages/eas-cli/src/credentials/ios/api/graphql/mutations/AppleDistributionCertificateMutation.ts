import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../../../../../graphql/client';
import { AppleDistributionCertificate } from '../../../../../graphql/generated';
import { AppleDistributionCertificateFragment } from '../../../../../graphql/types/credentials/AppleDistributionCertificate';
import { AppleTeamFragment } from '../../../../../graphql/types/credentials/AppleTeam';

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
                  ...${AppleDistributionCertificateFragment.name}
                  appleTeam {
                    ...${AppleTeamFragment.name}
                  }
                }
              }
            }
            ${AppleDistributionCertificateFragment.definition}
            ${AppleTeamFragment.definition}
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
