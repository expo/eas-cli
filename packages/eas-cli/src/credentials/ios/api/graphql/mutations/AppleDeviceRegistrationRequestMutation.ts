import { print } from 'graphql';
import gql from 'graphql-tag';

import { graphqlClient, withErrorHandlingAsync } from '../../../../../graphql/client';
import { AppleDeviceRegistrationRequest } from '../../../../../graphql/generated';
import { AppleDeviceRegistrationRequestFragmentDoc } from '../../../../../graphql/types/credentials/AppleDeviceRegistrationRequest';

const AppleDeviceRegistrationRequestMutation = {
  async createAppleDeviceRegistrationRequestAsync(
    appleTeamId: string,
    accountId: string
  ): Promise<AppleDeviceRegistrationRequest> {
    const data = await withErrorHandlingAsync(
      graphqlClient
        .mutation<{
          appleDeviceRegistrationRequest: {
            createAppleDeviceRegistrationRequest: AppleDeviceRegistrationRequest;
          };
        }>(
          gql`
            mutation AppleDeviceRegistrationRequestMutation($appleTeamId: ID!, $accountId: ID!) {
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
            ${print(AppleDeviceRegistrationRequestFragmentDoc)}
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
