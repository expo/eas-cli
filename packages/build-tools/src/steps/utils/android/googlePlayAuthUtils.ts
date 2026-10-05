import * as jose from 'jose';
import { KeyObject } from 'node:crypto';

import { GooglePlayAuthClient } from './GooglePlayAuthClient';

export type GoogleServiceAccount = {
  client_email: string;
  private_key: KeyObject;
  private_key_id?: string;
};

export namespace GooglePlayAuthUtils {
  export async function createAssertionAsync(
    serviceAccount: GoogleServiceAccount
  ): Promise<string> {
    return await new jose.SignJWT({
      scope: 'https://www.googleapis.com/auth/androidpublisher',
    })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT', kid: serviceAccount.private_key_id })
      .setIssuer(serviceAccount.client_email)
      .setAudience('https://oauth2.googleapis.com/token')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(serviceAccount.private_key);
  }

  export async function createTokenAsync(
    serviceAccount: GoogleServiceAccount,
    signal?: AbortSignal
  ): Promise<{ value: string; expiresAt: number }> {
    const startedAt = Date.now();
    const assertion = await createAssertionAsync(serviceAccount);
    const response = await new GooglePlayAuthClient().postAsync(
      '/token',
      { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion },
      signal
    );
    return { value: response.access_token, expiresAt: startedAt + response.expires_in * 1000 };
  }
}
