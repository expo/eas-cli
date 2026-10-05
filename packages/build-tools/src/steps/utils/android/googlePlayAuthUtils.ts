import * as jose from 'jose';
import { KeyObject } from 'node:crypto';

export type GoogleServiceAccount = {
  client_email: string;
  private_key: KeyObject;
  private_key_id?: string;
};

export async function createGooglePlayAssertionAsync(
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
