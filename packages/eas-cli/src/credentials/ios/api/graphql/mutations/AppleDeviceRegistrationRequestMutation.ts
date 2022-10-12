import { print } from 'graphql';
import gql from 'graphql-tag';

import { ExpoGraphqlClient } from '../../../../../commandUtils/context/contextUtils/createGraphqlClient';
import { withErrorHandlingAsync } from '../../../../../graphql/client';
import {
  AppleDeviceRegistrationRequestFragment,
  CreateAppleDeviceRegistrationRequestMutation,
} from '../../../../../graphql/generated';
import { AppleDeviceRegistrationRequestFragmentNode } from '../../../../../graphql/types/credentials/AppleDeviceRegistrationRequest';

export const AppleDeviceRegistrationRequestMutation = {
  async createAppleDeviceRegistrationRequestAsync(
    graphqlClient: ExpoGraphqlClient,
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
