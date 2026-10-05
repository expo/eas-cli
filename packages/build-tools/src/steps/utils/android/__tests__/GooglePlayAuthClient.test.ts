import nock from 'nock';

import { GooglePlayAuthClient } from '../GooglePlayAuthClient';
import { GooglePlayApiError } from '../GooglePlayErrors';

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
  { access_token: 'SECRET TOKEN', expires_in: 60, token_type: 'Bearer' },
  { access_token: 'SECRET TOKEN', expires_in: '3600', token_type: 'Bearer' },
  { access_token: 'SECRET TOKEN', expires_in: 3600, token_type: 1 },
  { access_token: 'SECRET TOKEN', expires_in: 3600, token_type: 'Basic' },
])('rejects invalid OAuth responses without exposing the token (%j)', async body => {
  nock('https://oauth2.googleapis.com').post('/token').reply(200, body);
  await expect(client.postAsync('/token', request)).rejects.toThrow(
    'Google did not return a valid OAuth token.'
  );
});

it('returns HTTP failures without retrying or retaining the response body', async () => {
  nock('https://oauth2.googleapis.com')
    .post('/token')
    .reply(503, { error_description: 'SECRET ASSERTION' });
  let error: unknown;
  try {
    await client.postAsync('/token', request);
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(GooglePlayApiError);
  expect(error).toMatchObject({ status: 503, apiMessage: '', reasons: [] });
  expect(JSON.stringify(error)).not.toContain('SECRET ASSERTION');
});
