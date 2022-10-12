import assert from 'assert';
import { print } from 'graphql';
import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../../../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../../../../../graphql/client';
import {
  AppleDistributionCertificateByAccountQuery,
  AppleDistributionCertificateByAppQuery,
  AppleDistributionCertificateFragment,
  IosDistributionType,
} from '../../../../../graphql/generated';
import { AppleDistributionCertificateFragmentNode } from '../../../../../graphql/types/credentials/AppleDistributionCertificate';
import { AppleTeamFragmentNode } from '../../../../../graphql/types/credentials/AppleTeam';

export const AppleDistributionCertificateQuery = {
  async getForAppAsync(
    graphqlClient: ExpoGraphqlClient,
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
                    iosAppBuildCredentialsList(
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
            additionalTypenames: [
              'AppleDistributionCertificate',
              'IosAppCredentials',
              'IosAppBuildCredentials',
            ],
          }
        )
        .toPromise()
    );
    assert(data.app, 'GraphQL: `app` not defined in server response');
    return (
      data.app.byFullName.iosAppCredentials[0]?.iosAppBuildCredentialsList[0]
        ?.distributionCertificate ?? null
    );
  },
  async getAllForAccountAsync(
    graphqlClient: ExpoGraphqlClient,
    accountName: string
  ): Promise<AppleDistributionCertificateFragment[]> {
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
          },
          {
            additionalTypenames: ['AppleDistributionCertificate'],
          }
        )
        .toPromise()
    );
    return data.account.byName.appleDistributionCertificates;
  },
};
