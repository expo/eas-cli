import assert from 'assert';
import { print } from 'graphql';
import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../../../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../../../../../graphql/client';
import {
  AppleDistributionCertificateByAppQuery,
  AppleDistributionCertificateFragment,
  AppleDistributionCertificatesPaginatedByAccountQuery,
  IosDistributionType,
} from '../../../../../graphql/generated';
import { AppleDistributionCertificateFragmentNode } from '../../../../../graphql/types/credentials/AppleDistributionCertificate';
import { AppleTeamFragmentNode } from '../../../../../graphql/types/credentials/AppleTeam';
import { Connection, QueryParams, fetchEntireDatasetAsync } from '../../../../../utils/relay';

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
    const paginatedGetterAsync = async (
      relayArgs: QueryParams
    ): Promise<Connection<AppleDistributionCertificateFragment>> => {
      return await AppleDistributionCertificateQuery.getAllForAccountPaginatedAsync(
        graphqlClient,
        accountName,
        relayArgs
      );
    };
    return await fetchEntireDatasetAsync({
      paginatedGetterAsync,
      progressBarLabel: 'fetching Apple Distribution Certificates...',
    });
  },
  async getAllForAccountPaginatedAsync(
    graphqlClient: ExpoGraphqlClient,
    accountName: string,
    {
      after,
      first,
      before,
      last,
    }: { after?: string; first?: number; before?: string; last?: number }
  ): Promise<
    AppleDistributionCertificatesPaginatedByAccountQuery['account']['byName']['appleDistributionCertificatesPaginated']
  > {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<AppleDistributionCertificatesPaginatedByAccountQuery>(
          gql`
            query AppleDistributionCertificatesPaginatedByAccountQuery(
              $accountName: String!
              $after: String
              $first: Int
              $before: String
              $last: Int
            ) {
              account {
                byName(accountName: $accountName) {
                  id
                  appleDistributionCertificatesPaginated(
                    after: $after
                    first: $first
                    before: $before
                    last: $last
                  ) {
                    edges {
                      cursor
                      node {
                        id
                        ...AppleDistributionCertificateFragment
                      }
                    }
                    pageInfo {
                      hasNextPage
                      hasPreviousPage
                      startCursor
                      endCursor
                    }
                  }
                }
              }
            }
            ${print(AppleDistributionCertificateFragmentNode)}
          `,
          {
            accountName,
            after,
            first,
            before,
            last,
          },
          {
            additionalTypenames: ['AppleDistributionCertificate'],
          }
        )
        .toPromise()
    );
    return data.account.byName.appleDistributionCertificatesPaginated;
  },
};
