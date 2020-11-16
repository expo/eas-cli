import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../../client';
import {
  AppleDistributionCertificate,
  AppleDistributionCertificateFragment,
} from '../../types/credentials/AppleDistributionCertificate';
import { AppleTeamFragment } from '../../types/credentials/AppleTeam';

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
