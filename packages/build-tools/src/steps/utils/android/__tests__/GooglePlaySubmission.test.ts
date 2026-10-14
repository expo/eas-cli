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
it.each([408, 429, 503])(
  'recovers an uncertain HTTP %s commit using the same edit',
  async status => {
    mockToken();
    api().post(`${editPath}:commit`).query(true).reply(status);
    api().get(editPath).reply(200, { id: 'edit' });
    api()
      .post(`${editPath}:commit`)
      .query({ changesInReviewBehavior: 'ERROR_IF_IN_REVIEW' })
      .reply(200, { id: 'edit' });
    await expect(commit()).resolves.toBeUndefined();
  }
);
it.each([404, 409, 503])('does not infer success from HTTP %s during recovery', async status => {
  mockToken();
  const logger = createMockLogger();
  api().post(`${editPath}:commit`).query(true).reply(503);
  api().get(editPath).reply(status);
  await expect(commit({ logger })).rejects.toThrow('Could not confirm');
  expect(logger.info).not.toHaveBeenCalled();
});
it.each([{}, { id: 'other-edit' }])(
  'does not accept an invalid recovery receipt %j',
  async receipt => {
    mockToken();
    api().post(`${editPath}:commit`).query(true).reply(503);
    api().get(editPath).reply(200, { id: 'edit' });
    api().post(`${editPath}:commit`).query(true).reply(200, receipt);
    await expect(commit()).rejects.toThrow('Could not confirm');
  }
);
it.each([400, 404, 409, 503])(
  'keeps the outcome unknown if the recovery commit returns HTTP %s',
  async status => {
    mockToken();
    const logger = createMockLogger();
    api().post(`${editPath}:commit`).query(true).reply(503);
    api().get(editPath).reply(200, { id: 'edit' });
    api().post(`${editPath}:commit`).query(true).reply(status);
    await expect(commit({ logger })).rejects.toThrow('Could not confirm');
    expect(logger.info).not.toHaveBeenCalled();
  }
);
it('preserves the review setting when recovering a lost response', async () => {
  mockToken();
  api()
    .post(`${editPath}:commit`)
    .query({ changesNotSentForReview: 'true' })
    .replyWithError('socket closed');
  api().get(editPath).reply(200, { id: 'edit' });
  api()
    .post(`${editPath}:commit`)
    .query({ changesNotSentForReview: 'true', changesInReviewBehavior: 'ERROR_IF_IN_REVIEW' })
    .reply(200, { id: 'edit' });
  await expect(commit({ changesNotSentForReview: true })).resolves.toBeUndefined();
});
it('does not send a recovery request after cancellation, and keeps the outcome unknown', async () => {
  mockToken();
  const controller = new AbortController();
  api()
    .post(`${editPath}:commit`)
    .query(true)
    .reply(() => {
      controller.abort();
      return [503];
    });
  await expect(commit({ signal: controller.signal })).rejects.toThrow('Could not confirm');
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
