import { getSessionUsingBrowserAuthFlowAsync } from './expoBrowserAuthFlowLauncher';
import { fetchUserAsync } from './fetchUser';

export async function fetchSessionSecretAndUserFromBrowserAuthFlowAsync({ sso = false }): Promise<{
  sessionSecret: string;
  id: string;
  username: string;
}> {
  const sessionSecret = await getSessionUsingBrowserAuthFlowAsync({ sso });

  const userData = await fetchUserAsync({ sessionSecret });

  return {
    sessionSecret,
    id: userData.id,
    username: userData.username,
  };
}
