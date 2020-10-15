import { URL } from 'url';

import { getExpoWebsiteBaseUrl } from '../../../api';
import { createAppleDeviceRegistrationRequestAsync } from '../../../credentials/ios/api/AppleDeviceRegistrationRequest';
import { findAppleTeamAsync } from '../../../credentials/ios/api/AppleTeam';
import { Account } from '../../../user/Account';

export async function generateDeviceRegistrationURL(account: Account, appleTeamIdentifier: string) {
  const { id: accountId } = account;
  const appleTeam = await findAppleTeamAsync({ accountId, appleTeamIdentifier });
  const appleDeviceRegistrationRequest = await createAppleDeviceRegistrationRequestAsync({
    accountId,
    appleTeamId: appleTeam.id,
  });
  return formatRegistrationURL(appleDeviceRegistrationRequest.id);
}

function formatRegistrationURL(id: string): string {
  return new URL(`/register-device/${id}`, getExpoWebsiteBaseUrl()).toString();
}
