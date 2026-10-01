import spawn from '@expo/spawn-async';
import nock from 'nock';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { aabPath, apkPath, packageName } from './fixtures/androidTestUtils';
import {
  api,
  editPath,
  mockToken,
  serviceAccount,
} from '../../utils/android/__tests__/fixtures/googlePlayTestUtils';
import { createGlobalContextMock } from '../../../__tests__/utils/context';
import { createMockLogger } from '../../../__tests__/utils/logger';
import { createSubmitToGooglePlayBuildFunction } from '../submitToGooglePlay';

jest.unmock('node-fetch');
jest.unmock('fs');
jest.unmock('node:fs');
jest.unmock('fs/promises');
jest.unmock('node:fs/promises');
jest.mock('@expo/spawn-async');

let directory: string;
let keyPath: string;
const logger = createMockLogger();

beforeEach(async () => {
  nock.disableNetConnect();
  jest.mocked(logger.child).mockReturnValue(logger);
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'play-submit-test-'));
  keyPath = path.join(directory, 'key.json');
  await fs.writeFile(keyPath, JSON.stringify(serviceAccount));
  jest.mocked(spawn).mockImplementation(
    command =>
      Object.assign(
        Promise.resolve({
          stdout:
            command === 'aapt2'
              ? `package: name='${packageName}' versionCode='42' versionName='1.0'`
              : `${packageName}\n`,
        }),
        { child: { kill: jest.fn() } }
      ) as unknown as ReturnType<typeof spawn>
  );
});
afterEach(async () => {
  const pending = nock.pendingMocks();
  nock.cleanAll();
  nock.enableNetConnect();
  await fs.rm(directory, { recursive: true, force: true });
  expect(pending).toEqual([]);
});

function createStep(inputs: Record<string, unknown> = {}) {
  return createSubmitToGooglePlayBuildFunction().createBuildStepFromFunctionCall(
    createGlobalContextMock({ logger, staticContextContent: { job: {} } }),
    {
      callInputs: {
        artifact_path: apkPath,
        package_name: packageName,
        service_account_key_path: keyPath,
        ...inputs,
      },
    }
  );
}
function mockCreate(): void {
  mockToken();
  api().post(editPath.slice(0, -5), {}).reply(200, { id: 'edit' });
}
async function mockUpload(artifactPath = apkPath): Promise<void> {
  const bytes = await fs.readFile(artifactPath);
  api()
    .post(`/upload${editPath}/${artifactPath === aabPath ? 'bundles' : 'apks'}`)
    .query({ uploadType: 'resumable' })
    .reply(200, '', { Location: 'https://androidpublisher.googleapis.com/upload/session' });
  api()
    .put('/upload/session', bytes)
    .matchHeader('content-range', `bytes 0-${bytes.length - 1}/${bytes.length}`)
    .reply(200, { versionCode: 42 });
}
function mockTrack(release: Record<string, unknown>, track = 'internal'): void {
  api()
    .put(`${editPath}/tracks/${encodeURIComponent(track)}`, {
      track,
      releases: [{ versionCodes: ['42'], ...release }],
    })
    .reply(200, { track });
}
function mockCommit(review: boolean | undefined = false): nock.Interceptor {
  const interceptor = api().post(`${editPath}:commit`, {});
  return review === undefined
    ? interceptor
    : interceptor.query({ changesNotSentForReview: String(review) });
}

it.each([
  [{}, { status: 'completed' }],
  [{ release_status: 'draft' }, { status: 'draft' }],
  [{ release_status: 'halted' }, { status: 'halted' }],
  [
    { release_status: 'halted', rollout: 0.2 },
    { status: 'inProgress', userFraction: 0.2 },
  ],
  [
    { release_status: 'inProgress', rollout: 0.25 },
    { status: 'inProgress', userFraction: 0.25 },
  ],
  [{ rollout: 0.5 }, { status: 'inProgress', userFraction: 0.5 }],
  [{ rollout: 1 }, { status: 'completed' }],
  [{ release_status: 'inProgress', rollout: 1 }, { status: 'completed' }],
])('commits one edit with release inputs %j', async (inputs, release) => {
  mockCreate();
  await mockUpload();
  mockTrack(release);
  mockCommit().reply(200, { id: 'edit' });
  const step = createStep(inputs);
  await step.executeAsync();
  expect(step.outputById.package_name.value).toBe(packageName);
  expect(step.outputById.version_code.value).toBe('42');
  expect(step.outputById.track.value).toBe('internal');
});

it('uploads an AAB to a custom track with an en-US changelog and review held', async () => {
  const changelog = 'New features\nQuotes: "test"';
  mockCreate();
  await mockUpload(aabPath);
  mockTrack(
    { status: 'completed', releaseNotes: [{ language: 'en-US', text: changelog }] },
    'wear:production'
  );
  mockCommit(true).reply(200, { id: 'edit' });
  const step = createStep({
    artifact_path: aabPath,
    track: 'wear:production',
    changelog,
    changes_not_sent_for_review: true,
  });
  await step.executeAsync();
  expect(step.outputById.track.value).toBe('wear:production');
  const logs = JSON.stringify([
    jest.mocked(logger.info).mock.calls,
    jest.mocked(logger.warn).mock.calls,
    jest.mocked(logger.error).mock.calls,
  ]);
  expect(logs).toContain(packageName);
  expect(logs).toContain('Uploaded version code: 42');
  expect(logs).not.toContain('test-access-token');
  expect(logs).not.toContain(serviceAccount.private_key);
});

it.each([
  { rollout: 0 },
  { rollout: -0.1 },
  { rollout: 1.1 },
  { rollout: NaN },
  { release_status: 'draft', rollout: 0.1 },
  { release_status: 'inProgress' },
  { release_status: 'halted', rollout: 1 },
])('rejects invalid release inputs before opening an edit: %j', async inputs => {
  await expect(createStep(inputs).executeAsync()).rejects.toThrow();
});

it.each([
  ['The query parameter changesNotSentForReview must not be set', true, undefined],
  ['Please set the query parameter changesNotSentForReview to true', false, true],
])(
  'retries commit only for the explicit Google review response: %s',
  async (message, initial, effective) => {
    mockCreate();
    await mockUpload();
    mockTrack({ status: 'completed' });
    mockCommit(initial).reply(400, { error: { message } });
    // undefined is passed directly here because mockCommit has a default argument.
    if (effective === undefined) {
      api().post(`${editPath}:commit`, {}).reply(200, { id: 'edit' });
    } else {
      mockCommit(effective).reply(200, { id: 'edit' });
    }
    await createStep({ changes_not_sent_for_review: initial }).executeAsync();
  }
);

it.each([
  [400, 'Package not found: dev.expo.submitfixture', 'upload the first version manually'],
  [400, 'Version code 42 has already been used.', 'Increase the Android version code'],
  [403, 'The caller does not have permission', 'app permissions'],
  [400, 'The apk has permissions that require a privacy policy', 'privacy policy'],
  [400, 'Only releases with status draft may be created on draft app.', 'release_status: draft'],
])(
  'maps Google upload error %s: %s and preserves it if cleanup fails',
  async (status, message, expected) => {
    mockCreate();
    api()
      .post(`/upload${editPath}/apks`)
      .query({ uploadType: 'resumable' })
      .reply(status, { error: { message } });
    api()
      .delete(editPath)
      .reply(500, { error: { message: 'cleanup failure' } });
    const step = createStep();
    await expect(step.executeAsync()).rejects.toThrow(expected);
    expect(() => step.outputById.version_code.value).toThrow('was not set');
  }
);

it.each(['network', 'server', 'invalid', 'expired'])(
  'does not retry %s commit errors or return success outputs',
  async kind => {
    mockCreate();
    await mockUpload();
    mockTrack({ status: 'completed' });
    if (kind === 'network') {
      mockCommit().replyWithError('connection reset');
    } else {
      mockCommit().reply(kind === 'server' ? 503 : kind === 'expired' ? 409 : 400, {
        error: { message: 'An invalid edit or release setting' },
      });
    }
    api().delete(editPath).reply(204);
    const step = createStep();
    await expect(step.executeAsync()).rejects.toThrow(
      kind === 'network' || kind === 'server' ? 'commit outcome is unknown' : 'Google Play'
    );
    expect(() => step.outputById.version_code.value).toThrow('was not set');
  }
);

it('checks the binary package before it creates an edit', async () => {
  await expect(createStep({ package_name: 'dev.expo.other' }).executeAsync()).rejects.toThrow(
    'does not match package_name'
  );
});

it('fails and deletes the edit when the track update fails', async () => {
  mockCreate();
  await mockUpload();
  api()
    .put(`${editPath}/tracks/internal`)
    .reply(409, { error: { message: 'This edit has been invalidated by another edit.' } });
  api().delete(editPath).reply(204);
  const step = createStep();
  await expect(step.executeAsync()).rejects.toThrow('concurrent edit');
  expect(() => step.outputById.version_code.value).toThrow('was not set');
});

it('does not repeat a failed review compatibility retry', async () => {
  mockCreate();
  await mockUpload();
  mockTrack({ status: 'completed' });
  const message = 'Please set the query parameter changesNotSentForReview to true';
  mockCommit(false).reply(400, { error: { message } });
  mockCommit(true).reply(400, { error: { message } });
  api().delete(editPath).reply(204);
  await expect(createStep().executeAsync()).rejects.toThrow('release or review settings');
});

it('requires a confirmed edit ID before it reports submission success', async () => {
  mockCreate();
  await mockUpload();
  mockTrack({ status: 'completed' });
  mockCommit().reply(200, {});
  api().delete(editPath).reply(204);
  const step = createStep();
  await expect(step.executeAsync()).rejects.toThrow('commit outcome is unknown');
  expect(() => step.outputById.version_code.value).toThrow('was not set');
});

it('does not expose malformed credential content in errors', async () => {
  await fs.writeFile(keyPath, 'SECRET PRIVATE KEY invalid json');
  const error = await createStep()
    .executeAsync()
    .catch(error => error);
  expect(String(error)).toContain('valid service-account JSON');
  expect(JSON.stringify(error)).not.toContain('SECRET PRIVATE KEY');
  expect(JSON.stringify(jest.mocked(logger.error).mock.calls)).not.toContain('SECRET PRIVATE KEY');
});

it('reports OAuth rejection as an authorization error without exposing the response', async () => {
  nock('https://oauth2.googleapis.com')
    .post('/token')
    .reply(400, { error: 'invalid_grant', error_description: 'SECRET ASSERTION' });
  const error = await createStep()
    .executeAsync()
    .catch(error => error);
  expect(String(error)).toContain('could not authorize the service account');
  expect(JSON.stringify(error)).not.toContain('SECRET ASSERTION');
  expect(JSON.stringify(jest.mocked(logger.error).mock.calls)).not.toContain('SECRET ASSERTION');
});
