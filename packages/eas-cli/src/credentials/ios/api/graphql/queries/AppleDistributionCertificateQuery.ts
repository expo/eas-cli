import { print } from 'graphql';
import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../../../../../graphql/client';
import {
  AppleDistributionCertificateByAccountQuery,
  AppleDistributionCertificateByAppQuery,
  AppleDistributionCertificateFragment,
  AppleTeamFragment,
  IosDistributionType,
} from '../../../../../graphql/generated';
import { AppleDistributionCertificateFragmentNode } from '../../../../../graphql/types/credentials/AppleDistributionCertificate';
import { AppleTeamFragmentNode } from '../../../../../graphql/types/credentials/AppleTeam';

export type AppleDistributionCertificateQueryResult = AppleDistributionCertificateFragment & {
  appleTeam?: AppleTeamFragment | null;
};
const AppleDistributionCertificateQuery = {
  async getForAppAsync(
    projectFullName: string,
    {
      appleAppIdentifierId,
      iosDistributionType,
    }: { appleAppIdentifierId: string; iosDistributionType: IosDistributionType }
  ): Promise<AppleDistributionCertificateQueryResult | null> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<AppleDistributionCertificateByAppQuery>(
          gql`
            query AppleDistributionCertificateByAppQuery(
              $projectFullName: String!
              $appleAppIdentifierId: String!
              $iosDistributionType: IosDistributionType!
            ) {
              app {
                byFullName(fullName: $projectFullName) {
                  id
                  iosAppCredentials(filter: { appleAppIdentifierId: $appleAppIdentifierId }) {
                    id
                    iosAppBuildCredentialsArray(
                      filter: { iosDistributionType: $iosDistributionType }
                    ) {
                      id
                      distributionCertificate {
                        id
                        ...AppleDistributionCertificateFragment
                        appleTeam {
                          id
                          ...AppleTeamFragment
                        }
                      }
                    }
                  }
                }
              }
            }
            ${print(AppleDistributionCertificateFragmentNode)}
            ${print(AppleTeamFragmentNode)}
          `,
          {
            projectFullName,
            appleAppIdentifierId,
            iosDistributionType,
          },
          {
            additionalTypenames: ['IosAppCredentials', 'IosAppBuildCredentials'],
          }
        )
        .toPromise()
    );
    return (
      data.app!.byFullName.iosAppCredentials[0]?.iosAppBuildCredentialsArray[0]
        ?.distributionCertificate ?? null
    );
  },
  async getAllForAccount(accountName: string): Promise<AppleDistributionCertificateQueryResult[]> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<AppleDistributionCertificateByAccountQuery>(
          gql`
            query AppleDistributionCertificateByAccountQuery($accountName: String!) {
              account {
                byName(accountName: $accountName) {
                  id
                  appleDistributionCertificates {
                    id
                    ...AppleDistributionCertificateFragment
                    appleTeam {
                      id
                      ...AppleTeamFragment
                    }
                  }
                }
              }
            }
            ${print(AppleDistributionCertificateFragmentNode)}
            ${print(AppleTeamFragmentNode)}
          `,
          {
            accountName,
          }
        )
        .toPromise()
    );
    return data.account.byName.appleDistributionCertificates;
  },
};

export { AppleDistributionCertificateQuery };
