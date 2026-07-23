import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../client';
import { SimulatorAvailabilityQuery, SimulatorAvailabilityQueryVariables } from '../generated';

const DEVICE_RUN_SESSIONS_GATE = 'device-run-sessions';

export const DeviceRunSessionAvailabilityQuery = {
  async byAppIdAsync(
    graphqlClient: ExpoGraphqlClient,
    appId: string
  ): Promise<{ accountName: string; available: boolean }> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .query<SimulatorAvailabilityQuery, SimulatorAvailabilityQueryVariables>(
          gql`
            query SimulatorAvailabilityQuery($appId: String!) {
              app {
                byId(appId: $appId) {
                  id
                  ownerAccount {
                    id
                    name
                    accountFeatureGates(filter: ["device-run-sessions"])
                  }
                }
              }
            }
          `,
          { appId },
          { additionalTypenames: ['Account'] }
        )
        .toPromise()
    );

    const ownerAccount = data.app.byId.ownerAccount;
    const gates: Record<string, boolean> = ownerAccount.accountFeatureGates;
    return {
      accountName: ownerAccount.name,
      available: gates[DEVICE_RUN_SESSIONS_GATE] === true,
    };
  },
};
