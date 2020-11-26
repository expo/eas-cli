import assert from 'assert';
import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../../../../../graphql/client';
import { AppleDevice, AppleTeam } from '../../../../../graphql/generated';
import { AppleDeviceFragment } from '../../../../../graphql/types/credentials/AppleDevice';
import { AppleTeamFragment } from '../../../../../graphql/types/credentials/AppleTeam';

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
};

export { AppleDeviceQuery };
