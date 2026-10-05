import { SystemError } from '@expo/eas-build-job';
import nock from 'nock';

import { GooglePlayAuthClient, GooglePlayAuthRequestError } from '../GooglePlayAuthClient';

jest.unmock('node-fetch');

const request = {
  grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer' as const,
  assertion: 'caller-signed-assertion',
};
let client: GooglePlayAuthClient;
beforeEach(() => {
  nock.disableNetConnect();
  client = new GooglePlayAuthClient();
});
afterEach(() => {
  const pending = nock.pendingMocks();
  nock.cleanAll();
  nock.enableNetConnect();
  expect(pending).toEqual([]);
});

it('posts the caller request and returns a validated response on each call', async () => {
  nock('https://oauth2.googleapis.com')
    .post('/token', request)
    .reply(200, { access_token: 'first-token', expires_in: 3600, token_type: 'Bearer' })
    .post('/token', request)
    .reply(200, { access_token: 'second-token', expires_in: 1800, token_type: 'Bearer' });
  await expect(client.postAsync('/token', request)).resolves.toEqual({
    access_token: 'first-token',
    expires_in: 3600,
    token_type: 'Bearer',
  });
  await expect(client.postAsync('/token', request)).resolves.toEqual({
    access_token: 'second-token',
    expires_in: 1800,
    token_type: 'Bearer',
  });
});

it.each([
  { access_token: '', expires_in: 3600, token_type: 'Bearer' },
  { access_token: 'example-token', expires_in: 60, token_type: 'Bearer' },
  { access_token: 'example-token', expires_in: '3600', token_type: 'Bearer' },
  { access_token: 'example-token', expires_in: 3600, token_type: 1 },
  { access_token: 'example-token', expires_in: 3600, token_type: 'Basic' },
])('includes response status and body for invalid OAuth responses (%j)', async body => {
  nock('https://oauth2.googleapis.com').post('/token').reply(200, body);
  await expect(client.postAsync('/token', request)).rejects.toThrow(
    `Malformed response from Google Play OAuth (HTTP 200): ${JSON.stringify(body)}`
  );
});

it('includes status and response text in HTTP failures without retrying', async () => {
  nock('https://oauth2.googleapis.com')
    .post('/token')
    .reply(503, { error_description: 'Service unavailable' });
  let error: unknown;
  try {
    await client.postAsync('/token', request);
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(GooglePlayAuthRequestError);
  expect(error).toMatchObject({
    status: 503,
    responseText: '{"error_description":"Service unavailable"}',
    message:
      'Google Play OAuth request failed (HTTP 503): {"error_description":"Service unavailable"}',
  });
});

it.each(['network failure', 'malformed JSON'])('returns a system error for %s', async failure => {
  const endpoint = nock('https://oauth2.googleapis.com').post('/token');
  if (failure === 'network failure') {
    endpoint.replyWithError('connection failed');
  } else {
    endpoint.reply(200, 'example-token is not JSON');
  }
  const result = client.postAsync('/token', request);
  await expect(result).rejects.toBeInstanceOf(SystemError);
  if (failure === 'network failure') {
    await expect(result).rejects.toMatchObject({
      cause: { message: expect.stringContaining('connection failed') },
    });
  } else {
    await expect(result).rejects.toThrow(
      'Malformed JSON response from Google Play OAuth (HTTP 200): example-token is not JSON'
    );
  }
});
