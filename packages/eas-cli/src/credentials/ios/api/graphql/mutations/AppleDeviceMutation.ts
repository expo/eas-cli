import { print } from 'graphql';
import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../../../../../graphql/client';
import {
  AppleDeviceFragment,
  AppleDeviceInput,
  CreateAppleDeviceMutation,
} from '../../../../../graphql/generated';
import { AppleDeviceFragmentNode } from '../../../../../graphql/types/credentials/AppleDevice';

const AppleDeviceMutation = {
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
};

export { AppleDeviceMutation };
