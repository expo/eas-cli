import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../client';
import {
  SimulatorAvailabilityQuery,
  SimulatorAvailabilityQueryVariables,
} from '../generated';

export const DeviceRunSessionAvailabilityQuery = {
  async byAppIdAsync(
    graphqlClient: ExpoGraphqlClient,
    appId: string
  ): Promise<SimulatorAvailabilityQuery['app']['byId']['ownerAccount']> {
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
                    deviceRunSessionsEnabled
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

    return data.app.byId.ownerAccount;
  },
};
