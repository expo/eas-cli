import { print } from 'graphql';
import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../../../../../graphql/client';
import {
  AppleDistributionCertificate,
  IosDistributionType,
} from '../../../../../graphql/generated';
import { AppleDistributionCertificateFragmentDoc } from '../../../../../graphql/types/credentials/AppleDistributionCertificate';
import { AppleTeamFragmentDoc } from '../../../../../graphql/types/credentials/AppleTeam';

const AppleDistributionCertificateQuery = {
  async getForAppAsync(
    projectFullName: string,
    {
      appleAppIdentifierId,
      iosDistributionType,
    }: { appleAppIdentifierId: string; iosDistributionType: IosDistributionType }
  ): Promise<AppleDistributionCertificate | null> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<{
          app: {
            byFullName: {
              iosAppCredentials: {
                iosAppBuildCredentialsArray: {
                  distributionCertificate?: AppleDistributionCertificate;
                }[];
              }[];
            };
          };
        }>(
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
            ${print(AppleDistributionCertificateFragmentDoc)}
            ${print(AppleTeamFragmentDoc)}
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
      data.app.byFullName.iosAppCredentials[0]?.iosAppBuildCredentialsArray[0]
        ?.distributionCertificate ?? null
    );
  },
  async getAllForAccount(accountName: string): Promise<AppleDistributionCertificate[]> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<{
          account: {
            byName: {
              appleDistributionCertificates: AppleDistributionCertificate[];
            };
          };
        }>(
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
            ${print(AppleDistributionCertificateFragmentDoc)}
            ${print(AppleTeamFragmentDoc)}
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
