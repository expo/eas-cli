import nock from 'nock';
import { createPrivateKey, createPublicKey, verify } from 'node:crypto';
import { ZodError } from 'zod';

import {
  api,
  editPath,
  mockToken,
  packageName,
  serviceAccount,
} from './fixtures/googlePlayTestUtils';
import { GooglePlayAuthClient } from '../GooglePlayAuthClient';
import { GooglePlayClient, GooglePlayNetworkError } from '../GooglePlayClient';

jest.unmock('node-fetch');

let client: GooglePlayClient;
beforeEach(() => {
  nock.disableNetConnect();
  const authClient = new GooglePlayAuthClient();
  jest.spyOn(authClient, 'postAsync').mockResolvedValue({
    access_token: 'test-access-token',
    expires_in: 3600,
    token_type: 'Bearer',
  });
  client = new GooglePlayClient(
    {
      ...serviceAccount,
      private_key: createPrivateKey(serviceAccount.private_key),
    },
    authClient
  );
});
afterEach(() => {
  const pending = nock.pendingMocks();
  nock.cleanAll();
  nock.enableNetConnect();
  jest.restoreAllMocks();
  expect(pending).toEqual([]);
});

it('creates an edit and validates the response', async () => {
  api().post(`/androidpublisher/v3/applications/${packageName}/edits`, {}).reply(200, {
    id: 'edit',
    expiryTimeSeconds: '1234567890',
  });
  await expect(
    client.postAsync(
      '/androidpublisher/v3/applications/:packageName/edits',
      {},
      {
        packageName,
      }
    )
  ).resolves.toEqual({ id: 'edit', expiryTimeSeconds: '1234567890' });
});

it('encodes track path parameters and validates track responses', async () => {
  api().get(`${editPath}/tracks/wear%3Aproduction`).reply(200, { track: 'wear:production' });
  await expect(
    client.getAsync('/androidpublisher/v3/applications/:packageName/edits/:editId/tracks/:track', {
      packageName,
      editId: 'edit',
      track: 'wear:production',
    })
  ).resolves.toEqual({ track: 'wear:production' });
});

it('rejects invalid rollout requests before sending them', async () => {
  await expect(
    client.putAsync(
      '/androidpublisher/v3/applications/:packageName/edits/:editId/tracks/:track',
      {
        track: 'production',
        releases: [{ versionCodes: ['123'], status: 'inProgress', userFraction: 1 }],
      },
      { packageName, editId: 'edit', track: 'production' }
    )
  ).rejects.toBeInstanceOf(ZodError);
});

it('does not retry an ambiguous edit commit', async () => {
  api()
    .post(`${editPath}:commit`, {})
    .query({ changesNotSentForReview: false })
    .replyWithError('Lost response');
  await expect(
    client.postAsync(
      '/androidpublisher/v3/applications/:packageName/edits/:editId:commit',
      {},
      { packageName, editId: 'edit' },
      { query: { changesNotSentForReview: false } }
    )
  ).rejects.toBeInstanceOf(GooglePlayNetworkError);
});

it('deletes an edit with an empty response', async () => {
  api().delete(editPath).reply(204);
  await expect(
    client.deleteAsync('/androidpublisher/v3/applications/:packageName/edits/:editId', {
      packageName,
      editId: 'edit',
    })
  ).resolves.toBeUndefined();
});

it('rejects malformed success responses without exposing their contents', async () => {
  api()
    .get(editPath)
    .reply(200, { id: 'edit', expiryTimeSeconds: { secret: 'PRIVATE' } });
  await expect(
    client.getAsync('/androidpublisher/v3/applications/:packageName/edits/:editId', {
      packageName,
      editId: 'edit',
    })
  ).rejects.toThrow('Google Play returned an invalid response.');
});

it('retains structured API errors', async () => {
  api()
    .get(editPath)
    .reply(403, { error: { message: 'Denied', errors: [{ reason: 'forbidden' }] } });
  await expect(
    client.getAsync('/androidpublisher/v3/applications/:packageName/edits/:editId', {
      packageName,
      editId: 'edit',
    })
  ).rejects.toMatchObject({ status: 403, apiMessage: 'Denied', reasons: ['forbidden'] });
});

it('signs the service-account JWT, shares a token across concurrent requests, and refreshes before expiry', async () => {
  client = new GooglePlayClient({
    ...serviceAccount,
    private_key: createPrivateKey(serviceAccount.private_key),
  });
  api().get(editPath).times(3).reply(200, { id: 'edit' });
  let assertion: string | undefined;
  nock('https://oauth2.googleapis.com')
    .post('/token', body => {
      assertion = body.assertion;
      return body.grant_type === 'urn:ietf:params:oauth:grant-type:jwt-bearer';
    })
    .reply(200, { access_token: 'test-access-token', expires_in: 3600, token_type: 'Bearer' });
  await Promise.all([
    client.getAsync('/androidpublisher/v3/applications/:packageName/edits/:editId', {
      packageName,
      editId: 'edit',
    }),
    client.getAsync('/androidpublisher/v3/applications/:packageName/edits/:editId', {
      packageName,
      editId: 'edit',
    }),
  ]);
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
  await client.getAsync('/androidpublisher/v3/applications/:packageName/edits/:editId', {
    packageName,
    editId: 'edit',
  });
});

it.each([429, 503])('retries temporary OAuth HTTP %s failures', async status => {
  client = new GooglePlayClient({
    ...serviceAccount,
    private_key: createPrivateKey(serviceAccount.private_key),
  });
  nock('https://oauth2.googleapis.com').post('/token').reply(status);
  mockToken();
  api().get(editPath).reply(200, { id: 'edit' });
  await expect(
    client.getAsync('/androidpublisher/v3/applications/:packageName/edits/:editId', {
      packageName,
      editId: 'edit',
    })
  ).resolves.toEqual({ id: 'edit' });
});

it('cancels an OAuth retry wait and permits a later token request', async () => {
  client = new GooglePlayClient({
    ...serviceAccount,
    private_key: createPrivateKey(serviceAccount.private_key),
  });
  const controller = new AbortController();
  const reason = new Error('Cancelled by caller');
  nock('https://oauth2.googleapis.com')
    .post('/token')
    .reply(() => {
      setTimeout(() => controller.abort(reason), 20);
      return [503, {}];
    });
  await expect(
    client.getAsync(
      '/androidpublisher/v3/applications/:packageName/edits/:editId',
      { packageName, editId: 'edit' },
      controller.signal
    )
  ).rejects.toBe(reason);
  mockToken();
  api().get(editPath).reply(200, { id: 'edit' });
  await expect(
    client.getAsync('/androidpublisher/v3/applications/:packageName/edits/:editId', {
      packageName,
      editId: 'edit',
    })
  ).resolves.toEqual({ id: 'edit' });
});

it('does not retry a permanent OAuth HTTP failure', async () => {
  client = new GooglePlayClient({
    ...serviceAccount,
    private_key: createPrivateKey(serviceAccount.private_key),
  });
  nock('https://oauth2.googleapis.com').post('/token').reply(403);
  await expect(
    client.getAsync('/androidpublisher/v3/applications/:packageName/edits/:editId', {
      packageName,
      editId: 'edit',
    })
  ).rejects.toThrow('Google could not authorize the service account (HTTP 403).');
});
