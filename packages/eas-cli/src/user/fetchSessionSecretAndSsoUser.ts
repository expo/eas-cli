import { getExpoWebsiteBaseUrl, getSsoLocalServerPortAsync } from '../api';
import { initiateAuthFlowAsync } from './expoSsoLauncher';
import { fetchUserAsync } from './fetchUser';

export async function fetchSessionSecretAndSsoUserAsync(): Promise<{
  sessionSecret: string;
  id: string;
  username: string;
}> {
  const config = {
    expoWebsiteUrl: getExpoWebsiteBaseUrl(),
    serverPort: await getSsoLocalServerPortAsync(),
  };
  const sessionSecret = await initiateAuthFlowAsync(config);

  const userData = await fetchUserAsync({ sessionSecret });

  return {
    sessionSecret,
    id: userData.id,
    username: userData.username,
  };
}
