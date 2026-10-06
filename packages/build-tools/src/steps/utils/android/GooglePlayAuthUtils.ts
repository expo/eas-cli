import { UserError } from '@expo/eas-build-job';
import fs from 'node:fs/promises';
import { z } from 'zod';
import * as jose from 'jose';
import { KeyObject, createPrivateKey } from 'node:crypto';

import { GooglePlayAuthClient } from './GooglePlayAuthClient';

export type GoogleServiceAccount = {
  client_email: string;
  private_key: KeyObject;
  private_key_id?: string;
};

export namespace GooglePlayAuthUtils {
  export async function loadGoogleServiceAccountAsync({
    keyPath,
  }: {
    keyPath: string;
  }): Promise<GoogleServiceAccount> {
    try {
      const credentials = z
        .object({
          type: z.literal('service_account'),
          client_email: z.email(),
          private_key: z.string().min(1),
          private_key_id: z.string().optional(),
        })
        .parse(JSON.parse(await fs.readFile(keyPath, 'utf8')));
      const privateKey = createPrivateKey(credentials.private_key);
      if (privateKey.asymmetricKeyType !== 'rsa') {
        throw new Error('Expected an RSA private key.');
      }
      return { ...credentials, private_key: privateKey };
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        throw new UserError(
          'EAS_GOOGLE_PLAY_INVALID_CREDENTIALS',
          `Service-account key file not found at ${keyPath}.`,
          { cause: error }
        );
      }
      // Neither JSON parse errors nor validation errors may include credential content.
      throw new UserError(
        'EAS_GOOGLE_PLAY_INVALID_CREDENTIALS',
        'Cannot read the Google service-account key. Provide a valid service-account JSON file.'
      );
    }
  }

  async function createAssertionAsync(serviceAccount: GoogleServiceAccount): Promise<string> {
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
