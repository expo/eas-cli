import nock from 'nock';
import { SystemError } from '@expo/eas-build-job';
import { ZodError } from 'zod';

import { GooglePlayClient } from '../GooglePlayClient';

const packageName = 'dev.expo.submitfixture';
const editPath = `/androidpublisher/v3/applications/${packageName}/edits/edit`;
const api = (): nock.Scope =>
  nock('https://androidpublisher.googleapis.com', {
    reqheaders: { authorization: 'Bearer test-access-token' },
  });

jest.unmock('node-fetch');

let client: GooglePlayClient;
beforeEach(() => {
  nock.disableNetConnect();
  client = new GooglePlayClient({ token: 'test-access-token' });
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
  ).rejects.toBeInstanceOf(SystemError);
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

it.each(['body', 'query'])('rejects extra fields in an empty %s', async field => {
  await expect(
    client.postAsync(
      '/androidpublisher/v3/applications/:packageName/edits',
      (field === 'body' ? { unexpected: true } : {}) as never,
      { packageName },
      { query: (field === 'query' ? { unexpected: true } : {}) as never }
    )
  ).rejects.toBeInstanceOf(ZodError);
});
