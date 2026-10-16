import { SystemError, UserError } from '@expo/eas-build-job';
import nock from 'nock';
import { Response } from 'node-fetch';

import { api, editPath, mockToken, packageName, serviceAccount } from './googlePlayTestUtils';
import { createMockLogger } from '../../../../__tests__/utils/logger';
import { GooglePlayAuthRequestError } from '../GooglePlayAuthClient';
import { GooglePlayApiError } from '../GooglePlayApiError';
import { GooglePlayClient } from '../GooglePlayClient';
import { GooglePlayCommitOutcomeUnknownError, GooglePlayUtils } from '../GooglePlayUtils';

jest.unmock('node-fetch');
jest.mock('promise-retry', () => {
  const actual = jest.requireActual('promise-retry');
  return (fn: Parameters<typeof actual>[0], options: object) =>
    actual(fn, { ...options, minTimeout: 1, maxTimeout: 1, randomize: false });
});
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
  logger = createMockLogger(),
}: {
  signal?: AbortSignal;
  changesNotSentForReview?: boolean;
  logger?: ReturnType<typeof createMockLogger>;
} = {}) {
  return GooglePlayUtils.commitEditAsync(new GooglePlayClient(serviceAccount), {
    packageName,
    editId: 'edit',
    changesNotSentForReview,
    logger,
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
    const logger = createMockLogger();
    mockToken();
    api().post(`${editPath}:commit`).query(initialQuery).reply(400, { error: { message } });
    api().post(`${editPath}:commit`).query(retryQuery).reply(200, { id: 'edit' });
    await expect(commit({ changesNotSentForReview, logger })).resolves.toBeUndefined();
    expect(logger.info).toHaveBeenLastCalledWith(
      changesNotSentForReview
        ? 'Google Play saved the release using its normal review process. Check its review and publishing status at https://play.google.com/console/.'
        : 'Google Play saved the changes without sending them for review. Send them for review at https://play.google.com/console/.'
    );
  }
);
it.each([408, 429, 503])('retries a transient HTTP %s commit on the same edit', async status => {
  mockToken();
  api().post(`${editPath}:commit`).query(true).reply(status);
  api().post(`${editPath}:commit`).query({}).reply(200, { id: 'edit' });
  await expect(commit()).resolves.toBeUndefined();
});
it('preserves cancellation before commit is sent', async () => {
  const controller = new AbortController();
  const reason = new Error('cancelled before commit');
  controller.abort(reason);
  await expect(commit({ signal: controller.signal })).rejects.toBe(reason);
});
const pendingUploadMessage = 'Some of the Android App Bundle uploads are not completed yet.';

it.each([false, true])(
  'waits for bundle processing without changing review settings (%s)',
  async changesNotSentForReview => {
    const logger = createMockLogger();
    const query = changesNotSentForReview ? { changesNotSentForReview: 'true' } : {};
    mockToken();
    api()
      .post(`${editPath}:commit`, {})
      .query(query)
      .reply(400, { error: { message: pendingUploadMessage } });
    api().post(`${editPath}:commit`, {}).query(query).reply(200, { id: 'edit' });
    await expect(commit({ changesNotSentForReview, logger })).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Google Play is still processing')
    );
  }
);

it('stops waiting for bundle processing after six attempts', async () => {
  mockToken();
  api()
    .post(`${editPath}:commit`)
    .query({})
    .times(6)
    .reply(400, { error: { message: pendingUploadMessage } });
  await expect(commit()).rejects.toThrow('Google Play did not finish processing');
});

it('does not retry an unrelated commit precondition', async () => {
  mockToken();
  api()
    .post(`${editPath}:commit`)
    .query({})
    .reply(400, { error: { message: 'Precondition check failed.' } });
  await expect(commit()).rejects.toBeInstanceOf(GooglePlayApiError);
});

it('checks cancellation before sending a processing retry', async () => {
  const controller = new AbortController();
  const reason = new Error('cancelled while waiting');
  const logger = createMockLogger();
  jest.spyOn(logger, 'warn').mockImplementation(() => controller.abort(reason));
  mockToken();
  api()
    .post(`${editPath}:commit`)
    .query({})
    .reply(400, { error: { message: pendingUploadMessage } });
  await expect(commit({ signal: controller.signal, logger })).rejects.toBe(reason);
});

it('does not report success if a processing retry has no valid commit receipt', async () => {
  mockToken();
  api()
    .post(`${editPath}:commit`)
    .query({})
    .reply(400, { error: { message: pendingUploadMessage } });
  api().post(`${editPath}:commit`).query({}).reply(200, { id: 'different-edit' });
  await expect(commit()).rejects.toBeInstanceOf(GooglePlayCommitOutcomeUnknownError);
});
it('preserves OAuth rejection before commit is sent', async () => {
  nock('https://oauth2.googleapis.com').post('/token').reply(400, { error: 'invalid_grant' });
  await expect(commit()).rejects.toBeInstanceOf(GooglePlayAuthRequestError);
});
it.each([
  [404, 'Package not found', 'EAS_GOOGLE_PLAY_FIRST_UPLOAD'],
  [403, 'Version code 144 has already been used', 'EAS_GOOGLE_PLAY_VERSION_CODE_USED'],
  [403, 'The caller does not have permission', 'EAS_GOOGLE_PLAY_PERMISSION_DENIED'],
  [403, 'privacy policy required', 'EAS_GOOGLE_PLAY_PRIVACY_POLICY_REQUIRED'],
  [403, 'wrong signing key', 'EAS_GOOGLE_PLAY_REQUEST_FAILED'],
  [400, 'privacy policy required', 'EAS_GOOGLE_PLAY_PRIVACY_POLICY_REQUIRED'],
  [400, 'Only releases with status draft may be created on draft app', 'EAS_GOOGLE_PLAY_DRAFT_APP'],
  [400, 'Staged rollout is not permitted on draft app', 'EAS_GOOGLE_PLAY_DRAFT_APP'],
  [409, 'edit invalid', 'EAS_GOOGLE_PLAY_EDIT_INVALID'],
  [400, 'unknown track', 'EAS_GOOGLE_PLAY_INVALID_RELEASE'],
] as const)('keeps the Google error behind %s %s', (status, message, code) => {
  const original = new GooglePlayApiError(status, message, []);
  const mapped = GooglePlayUtils.mapGooglePlayError(original, packageName);
  expect(mapped).toBeInstanceOf(UserError);
  expect(mapped).toMatchObject({
    errorCode: code,
    cause: original,
  });
  if (code === 'EAS_GOOGLE_PLAY_REQUEST_FAILED' || code === 'EAS_GOOGLE_PLAY_INVALID_RELEASE') {
    expect((mapped as Error).message).toContain(message);
  } else {
    expect((mapped as Error).message).not.toContain(message);
  }
  expect((mapped as Error).message).toContain(`App: ${packageName}`);
  expect((mapped as Error).message).toContain('https://play.google.com/console/');
  expect((mapped as Error).message).not.toContain('Google Play error:');
  if (code === 'EAS_GOOGLE_PLAY_DRAFT_APP') {
    expect((mapped as Error).message).toContain('without a rollout');
    expect((mapped as Error).message).toContain('releaseStatus: "draft" in eas.json');
  }
});
it('maps a rejected OAuth key to a credential error', () => {
  const original = new GooglePlayAuthRequestError(400, 'invalid_grant');
  expect(GooglePlayUtils.mapGooglePlayError(original, packageName)).toMatchObject({
    errorCode: 'EAS_GOOGLE_PLAY_INVALID_CREDENTIALS',
    cause: original,
  });
});
it.each([408, 429, 500, 503])('classifies temporary HTTP %s errors as system errors', status => {
  for (const original of [
    new GooglePlayApiError(status, 'temporary failure', []),
    new GooglePlayAuthRequestError(status, 'temporarily_unavailable'),
  ]) {
    const mapped = GooglePlayUtils.mapGooglePlayError(original, packageName);
    expect(mapped).toBeInstanceOf(SystemError);
    expect(mapped).toMatchObject({ cause: original });
    expect((mapped as Error).message).not.toContain('settings');
  }
});
it('keeps non-Google errors unchanged', () => {
  const error = new SystemError('file failure');
  expect(GooglePlayUtils.mapGooglePlayError(error, packageName)).toBe(error);
});
it('keeps the Google Play error response in metadata, not in the message', async () => {
  const response = {
    error: {
      code: 400,
      message: 'Precondition check failed.',
      status: 'FAILED_PRECONDITION',
      details: [
        {
          '@type': 'type.googleapis.com/google.rpc.PreconditionFailure',
          violations: [{ type: 'APP_SETUP', description: 'Complete the app setup.' }],
        },
      ],
    },
  };
  mockToken();
  api().post(`${editPath}:commit`).query({}).reply(400, response);
  const error = await commit().catch(error => error);
  const mapped = GooglePlayUtils.mapGooglePlayError(error, packageName);
  expect(mapped).toMatchObject({
    errorCode: 'EAS_GOOGLE_PLAY_INVALID_RELEASE',
    metadata: {
      googlePlayRequestPath: `${editPath}:commit`,
      googlePlayErrorResponse: JSON.stringify(response),
    },
  });
  expect((mapped as Error).message).not.toContain('APP_SETUP');
});
it('keeps the last Google Play error response when the commit outcome is unknown', async () => {
  mockToken();
  api()
    .post(`${editPath}:commit`)
    .query({})
    .times(6)
    .reply(503, { error: { message: 'Backend error' } });
  await expect(commit()).rejects.toMatchObject({
    metadata: {
      googlePlayRequestPath: `${editPath}:commit`,
      googlePlayErrorResponse: JSON.stringify({ error: { message: 'Backend error' } }),
    },
  });
});
it('does not keep the upload session query or a non-JSON response', async () => {
  const error = await GooglePlayApiError.fromResponseAsync(
    new Response('<html>upload_id=SECRET</html>', {
      status: 400,
      url: 'https://androidpublisher.googleapis.com/upload/session?upload_id=SECRET',
    })
  );
  expect(GooglePlayApiError.getErrorMetadata(error)).toEqual({
    googlePlayRequestPath: '/upload/session',
    googlePlayErrorResponse: undefined,
  });
});
