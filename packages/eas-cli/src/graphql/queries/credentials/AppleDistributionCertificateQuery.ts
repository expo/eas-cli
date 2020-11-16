import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../../client';
import {
  AppleDistributionCertificate,
  AppleDistributionCertificateFragment,
} from '../../types/credentials/AppleDistributionCertificate';
import { AppleTeamFragment } from '../../types/credentials/AppleTeam';
import { IosDistributionType } from '../../types/credentials/IosAppBuildCredentials';

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
            ${AppleDistributionCertificateFragment.definition}
            ${AppleTeamFragment.definition}
          `,
          {
            projectFullName,
            appleAppIdentifierId,
            iosDistributionType,
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
            ${AppleDistributionCertificateFragment.definition}
            ${AppleTeamFragment.definition}
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
