import { print } from 'graphql';
import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../../../../../graphql/client';
import {
  AppleDeviceFragment,
  AppleDeviceInput,
  CreateAppleDeviceMutation,
  DeleteAppleDeviceResult,
} from '../../../../../graphql/generated';
import { AppleDeviceFragmentNode } from '../../../../../graphql/types/credentials/AppleDevice';

export const AppleDeviceMutation = {
  async createAppleDeviceAsync(
    appleDeviceInput: AppleDeviceInput,
    accountId: string
  ): Promise<AppleDeviceFragment> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<CreateAppleDeviceMutation>(
          gql`
            mutation CreateAppleDeviceMutation(
              $appleDeviceInput: AppleDeviceInput!
              $accountId: ID!
            ) {
              appleDevice {
                createAppleDevice(appleDeviceInput: $appleDeviceInput, accountId: $accountId) {
                  id
                  ...AppleDeviceFragment
                }
              }
            }
            ${print(AppleDeviceFragmentNode)}
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
  async deleteAppleDeviceAsync(deviceId: string): Promise<string> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<DeleteAppleDeviceResult>(
          gql`
            mutation CreateAppleDeviceMutation($deviceId: ID!) {
              appleDevice {
                deleteAppleDevice(id: $deviceId) {
                  id
                }
              }
            }
          `,
          {
            deviceId,
          }
        )
        .toPromise()
    );
    return data.id;
  },
};
