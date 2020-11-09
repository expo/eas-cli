import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../../client';
import { AppleDevice, AppleDeviceClass } from '../../types/credentials/AppleDevice';

const AppleDeviceMutation = {
  async createAppleDeviceAsync(
    appleDeviceInput: {
      appleTeamId: string;
      identifier: string;
      name?: string;
      deviceClass?: AppleDeviceClass;
    },
    accountId: string
  ): Promise<AppleDevice> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<{ appleDevice: { createAppleDevice: AppleDevice } }>(
          gql`
            mutation AppleDeviceMutation($appleDeviceInput: AppleDeviceInput!, $accountId: ID!) {
              appleDevice {
                createAppleDevice(appleDeviceInput: $appleDeviceInput, accountId: $accountId) {
                  id
                }
              }
            }
          `,
          {
            appleDeviceInput,
            accountId,
          }
        )
        .toPromise()
    );
    return data.appleDevice.createAppleDevice;
  },
};

export { AppleDeviceMutation };
