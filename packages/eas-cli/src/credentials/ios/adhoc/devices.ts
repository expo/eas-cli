import { URL } from 'url';

import { getExpoWebsiteBaseUrl } from '../../../api';
import { Account } from '../../../user/Account';
import { createAppleDeviceRegistrationRequestAsync } from '../api/AppleDeviceRegistrationRequest';
import { findAppleTeamAsync } from '../api/AppleTeam';

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
