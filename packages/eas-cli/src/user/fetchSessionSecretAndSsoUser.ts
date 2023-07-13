import { getExpoWebsiteBaseUrl } from '../api';
import { getSessionUsingBrowserAuthFlowAsync } from './expoSsoLauncher';
import { fetchUserAsync } from './fetchUser';

export async function fetchSessionSecretAndSsoUserAsync(): Promise<{
  sessionSecret: string;
  id: string;
  username: string;
}> {
  const sessionSecret = await getSessionUsingBrowserAuthFlowAsync({
    expoWebsiteUrl: getExpoWebsiteBaseUrl(),
  });

  const userData = await fetchUserAsync({ sessionSecret });

  return {
    sessionSecret,
    id: userData.id,
    username: userData.username,
  };
}
