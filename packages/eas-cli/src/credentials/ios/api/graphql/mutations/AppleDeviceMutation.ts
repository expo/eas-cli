import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../../../../../graphql/client';
import { AppleDevice, AppleDeviceClass } from '../../../../../graphql/generated';
import { AppleDeviceFragment } from '../../../../../graphql/types/credentials/AppleDevice';

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
                  ...${AppleDeviceFragment.name}
                }
              }
            }
            ${AppleDeviceFragment.definition}
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
