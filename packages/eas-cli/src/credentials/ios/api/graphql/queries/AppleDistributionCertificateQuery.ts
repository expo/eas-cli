import { print } from 'graphql';
import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../../../../../graphql/client';
import {
  AppleDistributionCertificate,
  IosDistributionType,
} from '../../../../../graphql/generated';
import { AppleDistributionCertificateFragment } from '../../../../../graphql/types/credentials/AppleDistributionCertificate';
import { AppleTeamFragment } from '../../../../../graphql/types/credentials/AppleTeam';

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
            query(
              $projectFullName: String!
              $appleAppIdentifierId: String!
              $iosDistributionType: IosDistributionType!
            ) {
              app {
                byFullName(fullName: $projectFullName) {
                  iosAppCredentials(filter: { appleAppIdentifierId: $appleAppIdentifierId }) {
                    iosAppBuildCredentialsArray(
                      filter: { iosDistributionType: $iosDistributionType }
                    ) {
                      distributionCertificate {
                        ...${AppleDistributionCertificateFragment.name}
                        appleTeam {
                          ...${AppleTeamFragment.name}
                        }
                      }
                    }
                  }
                }
              }
            }
            ${print(AppleDistributionCertificateFragment.definition)}
            ${print(AppleTeamFragment.definition)}
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
            query($accountName: String!) {
              account {
                byName(accountName: $accountName) {
                  appleDistributionCertificates {
                    ...${AppleDistributionCertificateFragment.name}
                    appleTeam {
                      ...${AppleTeamFragment.name}
                    }
                  }
                }
              }
            }
            ${print(AppleDistributionCertificateFragment.definition)}
            ${print(AppleTeamFragment.definition)}
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
