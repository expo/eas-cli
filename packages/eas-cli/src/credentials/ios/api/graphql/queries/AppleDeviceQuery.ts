import assert from 'assert';
import { print } from 'graphql';
import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../../../../commandUtils/context/contextUtils/createGraphqlClient';
import { DeviceNotFoundError } from '../../../../../devices/utils/errors';
import { withErrorHandlingAsync } from '../../../../../graphql/client';
import {
  AppleDevice,
  AppleDeviceFragment,
  AppleDevicesByAppleTeamQuery,
  AppleDevicesByIdentifierQuery,
  AppleDevicesByTeamIdentifierQuery,
  AppleDevicesByTeamIdentifierQueryVariables,
  AppleTeamFragment,
} from '../../../../../graphql/generated';
import { AppleDeviceFragmentNode } from '../../../../../graphql/types/credentials/AppleDevice';
import { AppleTeamFragmentNode } from '../../../../../graphql/types/credentials/AppleTeam';
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
  ): Promise<AppleDevicesByIdentifierQueryResult> {
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
                    model
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
          { accountName, identifier },
          {
            additionalTypenames: ['AppleDevice', 'AppleTeam'],
          }
        )
        .toPromise()
    );

    const device = data.account.byName.appleDevices[0];
    if (!device) {
      throw new DeviceNotFoundError(
        `Device with id ${identifier} was not found on account ${accountName}.`
      );
    }
    return device;
  },
};
