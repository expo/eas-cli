import { SystemError, UserError } from '@expo/eas-build-job';
import nock from 'nock';

import { api, editPath, mockToken, packageName, serviceAccount } from './googlePlayTestUtils';
import { createMockLogger } from '../../../../__tests__/utils/logger';
import { GooglePlayAuthRequestError } from '../GooglePlayAuthClient';
import { GooglePlayApiError, GooglePlayClient } from '../GooglePlayClient';
import { GooglePlayUtils } from '../GooglePlayUtils';

jest.unmock('node-fetch');
beforeEach(() => nock.disableNetConnect());
afterEach(() => {
  const pending = nock.pendingMocks();
  nock.cleanAll();
  nock.enableNetConnect();
  expect(pending).toEqual([]);
});
function commit({
  signal,
  changesNotSentForReview = false,
}: {
  signal?: AbortSignal;
  changesNotSentForReview?: boolean;
} = {}) {
  return GooglePlayUtils.commitEditAsync(new GooglePlayClient(serviceAccount), {
    packageName,
    editId: 'edit',
    changesNotSentForReview,
    logger: createMockLogger(),
    signal,
  });
}
it.each([
  [false, {}],
  [true, { changesNotSentForReview: 'true' }],
] as const)(
  'commits with changesNotSentForReview=%s without a failed first request',
  async (changesNotSentForReview, query) => {
    mockToken();
    api().post(`${editPath}:commit`).query(query).reply(200, { id: 'edit' });
    await expect(commit({ changesNotSentForReview })).resolves.toBeUndefined();
  }
);
it.each([
  [
    true,
    { changesNotSentForReview: 'true' },
    'The query parameter changesNotSentForReview must not be set',
    {},
  ],
  [
    false,
    {},
    'Please set the query parameter changesNotSentForReview to true',
    { changesNotSentForReview: 'true' },
  ],
] as const)(
  'retries the rejected review setting (requested=%s)',
  async (changesNotSentForReview, initialQuery, message, retryQuery) => {
    mockToken();
    api().post(`${editPath}:commit`).query(initialQuery).reply(400, { error: { message } });
    api().post(`${editPath}:commit`).query(retryQuery).reply(200, { id: 'edit' });
    await expect(commit({ changesNotSentForReview })).resolves.toBeUndefined();
  }
);
it.each([408, 429, 503])('does not retry an uncertain HTTP %s commit', async status => {
  mockToken();
  api().post(`${editPath}:commit`).query(true).reply(status);
  await expect(commit()).rejects.toMatchObject({ cause: expect.objectContaining({ status }) });
});
it('preserves cancellation before commit is sent', async () => {
  const controller = new AbortController();
  const reason = new Error('cancelled before commit');
  controller.abort(reason);
  await expect(commit({ signal: controller.signal })).rejects.toBe(reason);
});
it('preserves OAuth rejection before commit is sent', async () => {
  nock('https://oauth2.googleapis.com').post('/token').reply(400, { error: 'invalid_grant' });
  await expect(commit()).rejects.toBeInstanceOf(GooglePlayAuthRequestError);
});
it.each([
  [404, 'Package not found', 'EAS_GOOGLE_PLAY_FIRST_UPLOAD'],
  [403, 'Version code 144 has already been used', 'EAS_GOOGLE_PLAY_VERSION_CODE_USED'],
  [403, 'The caller does not have permission', 'EAS_GOOGLE_PLAY_PERMISSION_DENIED'],
  [400, 'privacy policy required', 'EAS_GOOGLE_PLAY_PRIVACY_POLICY_REQUIRED'],
  [400, 'Only releases with status draft may be created on draft app', 'EAS_GOOGLE_PLAY_DRAFT_APP'],
  [409, 'edit invalid', 'EAS_GOOGLE_PLAY_EDIT_INVALID'],
  [400, 'unknown track', 'EAS_GOOGLE_PLAY_INVALID_RELEASE'],
  [500, 'server failure', 'EAS_GOOGLE_PLAY_REQUEST_FAILED'],
] as const)('keeps the Google error behind %s %s', (status, message, code) => {
  const original = new GooglePlayApiError(status, message, []);
  const mapped = GooglePlayUtils.mapGooglePlayError(original);
  expect(mapped).toBeInstanceOf(UserError);
  expect(mapped).toMatchObject({
    errorCode: code,
    message: expect.stringContaining(`Google Play said: ${message}`),
    cause: original,
  });
});
it('maps a rejected OAuth key but preserves transient OAuth errors', () => {
  const original = new GooglePlayAuthRequestError(400, 'invalid_grant');
  expect(GooglePlayUtils.mapGooglePlayError(original)).toMatchObject({
    errorCode: 'EAS_GOOGLE_PLAY_INVALID_CREDENTIALS',
    cause: original,
  });
  for (const status of [429, 503]) {
    const error = new GooglePlayAuthRequestError(status, 'temporarily_unavailable');
    expect(GooglePlayUtils.mapGooglePlayError(error)).toBe(error);
  }
});
it('keeps non-Google errors unchanged', () => {
  const error = new SystemError('file failure');
  expect(GooglePlayUtils.mapGooglePlayError(error)).toBe(error);
});
