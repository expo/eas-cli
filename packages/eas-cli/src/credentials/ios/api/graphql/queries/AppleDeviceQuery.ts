import assert from 'assert';
import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../../../../../graphql/client';
import { AppleDevice, AppleTeam } from '../../../../../graphql/generated';
import { AppleDeviceFragment } from '../../../../../graphql/types/credentials/AppleDevice';
import { AppleTeamFragment } from '../../../../../graphql/types/credentials/AppleTeam';

export type AppleTeamQueryResult = Pick<AppleTeam, 'id' | 'appleTeamIdentifier' | 'appleTeamName'>;

export type AppleDeviceQueryResult = Pick<
  AppleDevice,
  'id' | 'identifier' | 'name' | 'deviceClass' | 'enabled'
>;

export type AppleDevicesByTeamIdentifierQueryResult = AppleTeamQueryResult & {
  appleDevices: AppleDeviceQueryResult[];
};

export type AppleDevicesByIdentifierQueryResult = AppleDeviceQueryResult & {
  appleTeam: AppleTeamQueryResult;
};

const AppleDeviceQuery = {
  async getAllByAppleTeamIdentifierAsync(
    accountId: string,
    appleTeamIdentifier: string
  ): Promise<AppleDevice[]> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<{ appleTeam: { byAppleTeamIdentifier: AppleTeam } }>(
          gql`
            query($accountId: ID!, $appleTeamIdentifier: String!) {
              appleTeam {
                byAppleTeamIdentifier(accountId: $accountId, identifier: $appleTeamIdentifier) {
                  ...${AppleTeamFragment.name}
                  appleDevices {
                    ...${AppleDeviceFragment.name}
                    appleTeam {
                      ...${AppleTeamFragment.name}
                    }
                  }
                }
              }
            }
            ${AppleTeamFragment.definition}
            ${AppleDeviceFragment.definition}
          `,
          {
            accountId,
            appleTeamIdentifier,
          },
          { additionalTypenames: ['AppleDevice'] }
        )
        .toPromise()
    );
    const { appleDevices } = data.appleTeam.byAppleTeamIdentifier;
    assert(appleDevices, 'Apple Devices should be defined in this context - enforced by GraphQL');
    return appleDevices.filter(device => device) as AppleDevice[];
  },

  async getAllForAppleTeamAsync(
    accountName: string,
    appleTeamIdentifier: string
  ): Promise<AppleDevicesByTeamIdentifierQueryResult | null> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<{ account: { byName: { appleTeams: AppleDevicesByTeamIdentifierQueryResult[] } } }>(
          gql`
            query AppleDevicesByTeamIdentifier(
              $accountName: String!
              $appleTeamIdentifier: String!
            ) {
              account {
                byName(accountName: $accountName) {
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

  async getByDeviceIdentifier(
    accountName: string,
    identifier: string
  ): Promise<AppleDevicesByIdentifierQueryResult | null> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<{ account: { byName: { appleDevices: AppleDevicesByIdentifierQueryResult[] } } }>(
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

export { AppleDeviceQuery };
