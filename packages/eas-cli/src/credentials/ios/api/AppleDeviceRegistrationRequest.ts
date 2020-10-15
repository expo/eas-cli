import assert from 'assert';
import gql from 'graphql-tag';

import { graphqlClient } from '../../../api';

interface AppleDeviceRegistrationRequest {
  id: string;
}

export async function createAppleDeviceRegistrationRequestAsync({
  appleTeamId,
  accountId,
}: {
  appleTeamId: string;
  accountId: string;
}): Promise<AppleDeviceRegistrationRequest> {
  const result = await graphqlClient
    .mutation(
      gql`
        mutation AppleDeviceRegistrationRequestMutation($appleTeamId: ID!, $accountId: ID!) {
          appleDeviceRegistrationRequest {
            createAppleDeviceRegistrationRequest(appleTeamId: $appleTeamId, accountId: $accountId) {
              id
            }
          }
        }
      `,
      {
        appleTeamId,
        accountId,
      }
    )
    .toPromise();

  const { data, error } = result;
  if (error?.graphQLErrors) {
    const err = error?.graphQLErrors[0];
    throw err;
  }
  const registrationRequest: AppleDeviceRegistrationRequest =
    data?.appleDeviceRegistrationRequest?.createAppleDeviceRegistrationRequest;
  assert(registrationRequest, `Failed to create the Apple Device Registration Request`);
  return registrationRequest;
}
