import { print } from 'graphql';
import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../../../../../graphql/client';
import {
  AppleDeviceRegistrationRequestFragment,
  CreateAppleDeviceRegistrationRequestMutation,
} from '../../../../../graphql/generated';
import { AppleDeviceRegistrationRequestFragmentNode } from '../../../../../graphql/types/credentials/AppleDeviceRegistrationRequest';

const AppleDeviceRegistrationRequestMutation = {
  async createAppleDeviceRegistrationRequestAsync(
    appleTeamId: string,
    accountId: string
  ): Promise<AppleDeviceRegistrationRequestFragment> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<CreateAppleDeviceRegistrationRequestMutation>(
          gql`
            mutation CreateAppleDeviceRegistrationRequestMutation(
              $appleTeamId: ID!
              $accountId: ID!
            ) {
              appleDeviceRegistrationRequest {
                createAppleDeviceRegistrationRequest(
                  appleTeamId: $appleTeamId
                  accountId: $accountId
                ) {
                  id
                  ...AppleDeviceRegistrationRequestFragment
                }
              }
            }
            ${print(AppleDeviceRegistrationRequestFragmentNode)}
          `,
          {
            appleTeamId,
            accountId,
          }
        )
        .toPromise()
    );
    return data.appleDeviceRegistrationRequest.createAppleDeviceRegistrationRequest;
  },
};

export { AppleDeviceRegistrationRequestMutation };
