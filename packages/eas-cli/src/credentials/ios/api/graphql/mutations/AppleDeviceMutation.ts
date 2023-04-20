import { print } from 'graphql';
import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../../../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../../../../../graphql/client';
import {
  AppleDeviceFragment,
  AppleDeviceInput,
  AppleDeviceUpdateInput,
  CreateAppleDeviceMutation,
  DeleteAppleDeviceResult,
  UpdateAppleDeviceMutation,
} from '../../../../../graphql/generated';
import { AppleDeviceFragmentNode } from '../../../../../graphql/types/credentials/AppleDevice';

export const AppleDeviceMutation = {
  async createAppleDeviceAsync(
    graphqlClient: ExpoGraphqlClient,
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
  async deleteAppleDeviceAsync(
    graphqlClient: ExpoGraphqlClient,
    deviceId: string
  ): Promise<string> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<DeleteAppleDeviceResult>(
          gql`
            mutation DeleteAppleDeviceMutation($deviceId: ID!) {
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
  async updateAppleDeviceAsync(
    graphqlClient: ExpoGraphqlClient,
    id: string,
    appleDeviceUpdateInput: AppleDeviceUpdateInput
  ): Promise<AppleDeviceFragment> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<UpdateAppleDeviceMutation>(
          gql`
            mutation UpdateAppleDeviceMutation(
              $id: ID!
              $appleDeviceUpdateInput: AppleDeviceUpdateInput!
            ) {
              appleDevice {
                updateAppleDevice(id: $id, appleDeviceUpdateInput: $appleDeviceUpdateInput) {
                  id
                  ...AppleDeviceFragment
                }
              }
            }
            ${print(AppleDeviceFragmentNode)}
          `,
          {
            id,
            appleDeviceUpdateInput,
          }
        )
        .toPromise()
    );
    return data.appleDevice.updateAppleDevice;
  },
};
