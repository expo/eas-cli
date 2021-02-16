import assert from 'assert';
import { print } from 'graphql';
import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../../../../../graphql/client';
import {
  AppleDistributionCertificateByAccountQuery,
  AppleDistributionCertificateByAppQuery,
  AppleDistributionCertificateFragment,
  IosDistributionType,
} from '../../../../../graphql/generated';
import { AppleDistributionCertificateFragmentNode } from '../../../../../graphql/types/credentials/AppleDistributionCertificate';
import { AppleTeamFragmentNode } from '../../../../../graphql/types/credentials/AppleTeam';

const AppleDistributionCertificateQuery = {
  async getForAppAsync(
    projectFullName: string,
    {
      appleAppIdentifierId,
      iosDistributionType,
    }: { appleAppIdentifierId: string; iosDistributionType: IosDistributionType }
  ): Promise<AppleDistributionCertificateFragment | null> {
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
    assert(data.app, 'GraphQL: `app` not defined in server response');
    return (
      data.app.byFullName.iosAppCredentials[0]?.iosAppBuildCredentialsArray[0]
        ?.distributionCertificate ?? null
    );
  },
  async getAllForAccount(accountName: string): Promise<AppleDistributionCertificateFragment[]> {
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
                  }
                }
              }
            }
            ${print(AppleDistributionCertificateFragmentNode)}
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
