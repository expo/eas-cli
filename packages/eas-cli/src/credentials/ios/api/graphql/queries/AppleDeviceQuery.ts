import { print } from 'graphql';
import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../../../../commandUtils/context/contextUtils/createGraphqlClient';
import { DeviceNotFoundError } from '../../../../../devices/utils/errors';
import { withErrorHandlingAsync } from '../../../../../graphql/client';
import {
  AppleDevice,
  AppleDeviceFilterInput,
  AppleDeviceFragment,
  AppleDevicesByTeamIdentifierQuery,
  AppleDevicesByTeamIdentifierQueryVariables,
  AppleDevicesPaginatedByAccountQuery,
  AppleTeamFragment,
} from '../../../../../graphql/generated';
import { AppleDeviceFragmentNode } from '../../../../../graphql/types/credentials/AppleDevice';
import { AppleTeamFragmentNode } from '../../../../../graphql/types/credentials/AppleTeam';
import { Connection, QueryParams, fetchEntireDatasetAsync } from '../../../../../utils/relay';
import { formatAppleTeam } from '../../../actions/AppleTeamFormatting';

export type AppleDeviceFragmentWithAppleTeam = AppleDeviceFragment & {
  appleTeam: AppleTeamFragment;
};

export type AppleDeviceQueryResult = Pick<
  AppleDevice,
  'id' | 'identifier' | 'name' | 'deviceClass' | 'enabled'
>;

export type AppleDevicesByTeamIdentifierQueryResult = AppleTeamFragment & {
  appleDevices: AppleDeviceQueryResult[];
};

export type AppleDevicesByIdentifierQueryResult = AppleDeviceQueryResult & {
  appleTeam: AppleTeamFragment;
};

export const AppleDeviceQuery = {
  async getAllByAppleTeamIdentifierAsync(
    graphqlClient: ExpoGraphqlClient,
    accountName: string,
    appleTeamIdentifier: string,
    { useCache = true }: { useCache?: boolean } = {}
  ): Promise<AppleDeviceFragmentWithAppleTeam[]> {
    const paginatedGetterAsync = async (
      relayArgs: QueryParams
    ): Promise<Connection<AppleDeviceFragmentWithAppleTeam>> => {
      return await AppleDeviceQuery.getAllForAccountPaginatedAsync(graphqlClient, accountName, {
        ...relayArgs,
        filter: {
          appleTeamIdentifier,
        },
        useCache,
      });
    };
    return await fetchEntireDatasetAsync({
      paginatedGetterAsync,
      progressBarLabel: 'Fetching Apple devices...',
    });
  },

  async getAllForAppleTeamAsync(
    graphqlClient: ExpoGraphqlClient,
    { accountName, appleTeamIdentifier, offset, limit }: AppleDevicesByTeamIdentifierQueryVariables
  ): Promise<AppleDeviceFragment[]> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<AppleDevicesByTeamIdentifierQuery>(
          gql`
            query AppleDevicesByTeamIdentifier(
              $accountName: String!
              $appleTeamIdentifier: String!
              $offset: Int
              $limit: Int
            ) {
              account {
                byName(accountName: $accountName) {
                  id
                  appleTeams(appleTeamIdentifier: $appleTeamIdentifier) {
                    id
                    appleTeamIdentifier
                    appleTeamName
                    appleDevices(offset: $offset, limit: $limit) {
                      id
                      identifier
                      name
                      deviceClass
                      enabled
                      model
                      createdAt
                    }
                  }
                }
              }
            }
          `,
          { accountName, appleTeamIdentifier, offset, limit },
          {
            additionalTypenames: ['AppleDevice', 'AppleTeam'],
          }
        )
        .toPromise()
    );
    const [appleTeam] = data.account.byName.appleTeams;
    const { appleDevices } = appleTeam;
    if (!appleDevices) {
      throw new Error(`Could not find devices on Apple team -- ${formatAppleTeam(appleTeam)}`);
    }
    return appleDevices;
  },

  async getByDeviceIdentifierAsync(
    graphqlClient: ExpoGraphqlClient,
    accountName: string,
    identifier: string
  ): Promise<AppleDeviceFragmentWithAppleTeam> {
    const paginatedGetterAsync = async (
      relayArgs: QueryParams
    ): Promise<Connection<AppleDeviceFragmentWithAppleTeam>> => {
      return await AppleDeviceQuery.getAllForAccountPaginatedAsync(graphqlClient, accountName, {
        ...relayArgs,
        filter: {
          identifier,
        },
      });
    };
    const devices = await fetchEntireDatasetAsync({
      paginatedGetterAsync,
    });
    const device = devices[0];
    if (!device) {
      throw new DeviceNotFoundError(
        `Device with id ${identifier} was not found on account ${accountName}.`
      );
    }
    return device;
  },
  async getAllForAccountPaginatedAsync(
    graphqlClient: ExpoGraphqlClient,
    accountName: string,
    {
      after,
      first,
      before,
      last,
      filter,
      useCache = true,
    }: {
      after?: string;
      first?: number;
      before?: string;
      last?: number;
      filter?: AppleDeviceFilterInput;
      useCache?: boolean;
    }
  ): Promise<AppleDevicesPaginatedByAccountQuery['account']['byName']['appleDevicesPaginated']> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<AppleDevicesPaginatedByAccountQuery>(
          gql`
            query AppleDevicesPaginatedByAccountQuery(
              $accountName: String!
              $after: String
              $first: Int
              $before: String
              $last: Int
              $filter: AppleDeviceFilterInput
            ) {
              account {
                byName(accountName: $accountName) {
                  id
                  appleDevicesPaginated(
                    after: $after
                    first: $first
                    before: $before
                    last: $last
                    filter: $filter
                  ) {
                    edges {
                      cursor
                      node {
                        id
                        ...AppleDeviceFragment
                        appleTeam {
                          id
                          ...AppleTeamFragment
                        }
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
            ${print(AppleTeamFragmentNode)}
            ${print(AppleDeviceFragmentNode)}
          `,
          {
            accountName,
            after,
            first,
            before,
            last,
            filter,
          },
          {
            additionalTypenames: ['AppleDevice'],
            requestPolicy: useCache ? 'cache-first' : 'network-only',
          }
        )
        .toPromise()
    );
    return data.account.byName.appleDevicesPaginated;
  },
};
