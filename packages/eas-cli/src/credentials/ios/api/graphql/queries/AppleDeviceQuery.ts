import assert from 'assert';
import { print } from 'graphql';
import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../../../../../graphql/client';
import {
  AppleDevice,
  AppleDeviceFragment,
  AppleDevicesByAppleTeamQuery,
  AppleDevicesByIdentifierQuery,
  AppleDevicesByTeamIdentifierQuery,
  AppleTeamFragment,
} from '../../../../../graphql/generated';
import { AppleDeviceFragmentNode } from '../../../../../graphql/types/credentials/AppleDevice';
import { AppleTeamFragmentNode } from '../../../../../graphql/types/credentials/AppleTeam';

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
    accountId: string,
    appleTeamIdentifier: string,
    { useCache = true }: { useCache?: boolean } = {}
  ): Promise<AppleDeviceFragmentWithAppleTeam[]> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<AppleDevicesByAppleTeamQuery>(
          gql`
            query AppleDevicesByAppleTeamQuery($accountId: ID!, $appleTeamIdentifier: String!) {
              appleTeam {
                byAppleTeamIdentifier(accountId: $accountId, identifier: $appleTeamIdentifier) {
                  id
                  ...AppleTeamFragment
                  appleDevices {
                    id
                    ...AppleDeviceFragment
                    appleTeam {
                      id
                      ...AppleTeamFragment
                    }
                  }
                }
              }
            }
            ${print(AppleTeamFragmentNode)}
            ${print(AppleDeviceFragmentNode)}
          `,
          {
            accountId,
            appleTeamIdentifier,
          },
          {
            additionalTypenames: ['AppleDevice'],
            requestPolicy: useCache ? 'cache-first' : 'network-only',
          }
        )
        .toPromise()
    );
    assert(
      data.appleTeam.byAppleTeamIdentifier,
      'byAppleTeamIdentifier should be defined in this context - enforced by GraphQL'
    );
    const { appleDevices } = data.appleTeam.byAppleTeamIdentifier;
    assert(appleDevices, 'Apple Devices should be defined in this context - enforced by GraphQL');
    return appleDevices;
  },

  async getAllForAppleTeamAsync(
    accountName: string,
    appleTeamIdentifier: string
  ): Promise<AppleDevicesByTeamIdentifierQueryResult | null> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<AppleDevicesByTeamIdentifierQuery>(
          gql`
            query AppleDevicesByTeamIdentifier(
              $accountName: String!
              $appleTeamIdentifier: String!
            ) {
              account {
                byName(accountName: $accountName) {
                  id
                  appleTeams(appleTeamIdentifier: $appleTeamIdentifier) {
                    id
                    appleTeamIdentifier
                    appleTeamName
                    appleDevices {
                      id
                      identifier
                      name
                      deviceClass
                      enabled
                    }
                  }
                }
              }
            }
          `,
          { accountName, appleTeamIdentifier }
        )
        .toPromise()
    );

    return data.account.byName.appleTeams[0];
  },

  async getByDeviceIdentifierAsync(
    accountName: string,
    identifier: string
  ): Promise<AppleDevicesByIdentifierQueryResult | null> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<AppleDevicesByIdentifierQuery>(
          gql`
            query AppleDevicesByIdentifier($accountName: String!, $identifier: String!) {
              account {
                byName(accountName: $accountName) {
                  id
                  appleDevices(identifier: $identifier) {
                    id
                    identifier
                    name
                    deviceClass
                    enabled
                    appleTeam {
                      id
                      appleTeamIdentifier
                      appleTeamName
                    }
                  }
                }
              }
            }
          `,
          { accountName, identifier }
        )
        .toPromise()
    );

    return data.account.byName.appleDevices[0] ?? null;
  },
};
