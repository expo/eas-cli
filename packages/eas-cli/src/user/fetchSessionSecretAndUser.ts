import { fetchUserAsync } from './fetchUser';
import { ApiV2Client } from '../api';

export async function fetchSessionSecretAndUserAsync({
  username,
  password,
  otp,
}: {
  username: string;
  password: string;
  otp?: string;
}): Promise<{ sessionSecret: string; id: string; username: string }> {
  // this is a logged-out endpoint
  const apiV2Client = new ApiV2Client({
    accessToken: null,
    sessionSecret: null,
  });
  const body = await apiV2Client.postAsync('auth/loginAsync', {
    body: { username, password, otp },
  });
  const { sessionSecret } = body.data;
  const userData = await fetchUserAsync({ sessionSecret });
  return {
    sessionSecret,
    id: userData.id,
    username: userData.username,
  };
}
