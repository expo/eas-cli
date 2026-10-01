import { UserError } from '@expo/eas-build-job';
import nock from 'nock';
import { createPublicKey, generateKeyPairSync, verify } from 'node:crypto';

import { api, editPath, mockToken, serviceAccount } from './fixtures/googlePlayTestUtils';
import { GooglePlayClient } from '../GooglePlayClient';

jest.unmock('node-fetch');

let client: GooglePlayClient;
beforeEach(() => {
  nock.disableNetConnect();
  client = new GooglePlayClient(serviceAccount);
});
afterEach(() => {
  const pending = nock.pendingMocks();
  nock.cleanAll();
  nock.enableNetConnect();
  jest.restoreAllMocks();
  expect(pending).toEqual([]);
});

it('signs the service-account JWT, shares a token across concurrent requests, and refreshes before expiry', async () => {
  let assertion: string | undefined;
  nock('https://oauth2.googleapis.com')
    .post('/token', body => {
      assertion = body.assertion;
      return body.grant_type === 'urn:ietf:params:oauth:grant-type:jwt-bearer';
    })
    .reply(200, { access_token: 'test-access-token', expires_in: 3600, token_type: 'Bearer' });
  api().get(editPath).times(3).reply(200, { id: 'edit' });
  await Promise.all([client.requestAsync('GET', editPath), client.requestAsync('GET', editPath)]);
  const [header, payload, signature] = assertion!.split('.');
  expect(JSON.parse(Buffer.from(payload, 'base64url').toString())).toMatchObject({
    iss: serviceAccount.client_email,
    aud: 'https://oauth2.googleapis.com/token',
    scope: 'https://www.googleapis.com/auth/androidpublisher',
  });
  expect(
    verify(
      'RSA-SHA256',
      Buffer.from(`${header}.${payload}`),
      createPublicKey(serviceAccount.private_key),
      Buffer.from(signature, 'base64url')
    )
  ).toBe(true);
  const now = Date.now();
  jest.spyOn(Date, 'now').mockReturnValue(now + 3540_001);
  mockToken();
  await client.requestAsync('GET', editPath);
});

it('reports the expected and actual private key types', () => {
  const key = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
    .privateKey.export({ type: 'pkcs8', format: 'pem' })
    .toString();
  const createClient = () => new GooglePlayClient({ ...serviceAccount, private_key: key });
  expect(createClient).toThrow(UserError);
  expect(createClient).toThrow(
    'Expected an RSA private key for the Google service account; received ec key type.'
  );
});

it('reports unreadable key data without exposing that data', () => {
  let error: unknown;
  try {
    new GooglePlayClient({ ...serviceAccount, private_key: 'SECRET INVALID KEY' });
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(UserError);
  expect(String(error)).toContain('Expected a valid RSA private key');
  expect(String(error)).toContain('could not be parsed');
  expect(JSON.stringify(error)).not.toContain('SECRET INVALID KEY');
});
