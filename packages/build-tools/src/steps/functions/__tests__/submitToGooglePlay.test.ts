import { SystemError, UserError } from '@expo/eas-build-job';
import nock from 'nock';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createGlobalContextMock } from '../../../__tests__/utils/context';
import {
  api,
  editPath,
  mockToken,
  packageName,
  serviceAccount,
} from '../../utils/android/__tests__/googlePlayTestUtils';
import { createSubmitToGooglePlayBuildFunction } from '../submitToGooglePlay';

jest.unmock('node-fetch');
jest.unmock('fs');
jest.unmock('node:fs');
jest.unmock('fs/promises');
jest.unmock('node:fs/promises');

let directory: string;
let keyPath: string;
let artifactPath: string;
const session = '/upload/test-session';
const createPath = `/androidpublisher/v3/applications/${packageName}/edits`;
beforeEach(async () => {
  nock.disableNetConnect();
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'play-submit-test-'));
  keyPath = path.join(directory, 'key.json');
  artifactPath = path.join(directory, 'app.aab');
  await fs.writeFile(artifactPath, 'binary');
  await fs.writeFile(
    keyPath,
    JSON.stringify({
      ...serviceAccount,
      type: 'service_account',
      private_key: serviceAccount.private_key.export({ format: 'pem', type: 'pkcs8' }),
    })
  );
});
afterEach(async () => {
  const pending = nock.pendingMocks();
  nock.cleanAll();
  nock.enableNetConnect();
  await fs.rm(directory, { recursive: true, force: true });
  expect(pending).toEqual([]);
});
function submission(extra: Record<string, unknown> = {}, signal?: AbortSignal) {
  const fn = createSubmitToGooglePlayBuildFunction();
  const step = fn.createBuildStepFromFunctionCall(createGlobalContextMock({}), {
    callInputs: {
      artifact_path: artifactPath,
      artifact_type: 'aab',
      package_name: packageName,
      service_account_key_path: keyPath,
      ...extra,
    },
  });
  const setters = step.outputs.map(output => jest.spyOn(output, 'set'));
  return {
    setters,
    step,
    run: async () =>
      await fn.fn!(step.ctx, {
        inputs: Object.fromEntries(
          step.inputs!.map(input => [input.id, { value: input.rawValue }])
        ),
        outputs: Object.fromEntries(step.outputs.map(output => [output.id, output])),
        env: {},
        signal,
      }),
  };
}
function upload() {
  mockToken();
  api().post(createPath).reply(200, { id: 'edit' });
  api()
    .post(`/upload${editPath}/bundles`)
    .query({ uploadType: 'resumable' })
    .reply(200, '', { Location: `https://androidpublisher.googleapis.com${session}` });
  nock('https://androidpublisher.googleapis.com').put(session).reply(200, { versionCode: 145 });
}

// SHA-256 of the fixture file, whose contents are "binary".
const binarySha256 = '9a3a45d01531a20e89ac6ae10b0b0beb0492acd7216a368aa062d1a5fecaf9cd';

function duplicateUpload(artifactType: 'apk' | 'aab', artifacts: Record<string, unknown>) {
  const resource = artifactType === 'aab' ? 'bundles' : 'apks';
  mockToken();
  api().post(createPath).reply(200, { id: 'edit' });
  api()
    .post(`/upload${editPath}/${resource}`)
    .query({ uploadType: 'resumable' })
    .reply(200, '', { Location: `https://androidpublisher.googleapis.com${session}` });
  nock('https://androidpublisher.googleapis.com')
    .put(session)
    .reply(403, { error: { message: 'Version code 145 has already been used' } });
  api().get(`${editPath}/${resource}`).reply(200, artifacts);
}

it.each(['apk', 'aab'] as const)(
  'reuses an identical uploaded %s and waits for commit',
  async artifactType => {
    duplicateUpload(
      artifactType,
      artifactType === 'aab'
        ? { bundles: [{ versionCode: 145, sha256: binarySha256 }] }
        : { apks: [{ versionCode: 145, binary: { sha256: binarySha256 } }] }
    );
    api()
      .get(`${editPath}/tracks/internal`)
      .reply(200, {
        track: 'internal',
        releases: artifactType === 'apk' ? [] : [{ status: 'completed', versionCodes: ['144'] }],
      });
    api()
      .put(`${editPath}/tracks/internal`, {
        track: 'internal',
        releases: [{ status: 'completed', versionCodes: ['145'] }],
      })
      .reply(200, { track: 'internal' });
    const task = submission({ artifact_type: artifactType });
    api()
      .post(`${editPath}:commit`)
      .query({})
      .reply(() => {
        expect(task.setters[0]).not.toHaveBeenCalled();
        return [200, { id: 'edit' }];
      });
    await task.run();
    expect(task.setters[0]).toHaveBeenCalledWith('145');
  }
);

it.each([
  ['aab', { bundles: [{ versionCode: 145, sha256: '0'.repeat(64) }] }],
  ['apk', { apks: [{ versionCode: 145, binary: { sha256: '0'.repeat(64) } }] }],
  ['aab', { bundles: [{ versionCode: 145 }] }],
  ['apk', { apks: [{ versionCode: 145 }] }],
  ['aab', {}],
  [
    'aab',
    {
      bundles: [
        { versionCode: 145, sha256: binarySha256 },
        { versionCode: 146, sha256: binarySha256 },
      ],
    },
  ],
] as const)(
  'does not recover %s without a unique hash match: %j',
  async (artifactType, artifacts) => {
    duplicateUpload(artifactType, artifacts);
    api().delete(editPath).reply(204);
    const task = submission({ artifact_type: artifactType });
    await expect(task.run()).rejects.toMatchObject({
      errorCode: 'EAS_GOOGLE_PLAY_VERSION_CODE_USED',
    });
    expect(task.setters[0]).not.toHaveBeenCalled();
  }
);

it.each([
  [
    'same release',
    [{ status: 'completed', versionCodes: ['145'] }],
    'EAS_GOOGLE_PLAY_RELEASE_ALREADY_EXISTS',
  ],
  [
    'newer release',
    [{ status: 'completed', versionCodes: ['146'] }],
    'EAS_GOOGLE_PLAY_RECOVERY_CONFLICT',
  ],
  ['draft', [{ status: 'draft', versionCodes: ['144'] }], 'EAS_GOOGLE_PLAY_RECOVERY_CONFLICT'],
  [
    'rollout',
    [{ status: 'inProgress', userFraction: 0.1, versionCodes: ['144'] }],
    'EAS_GOOGLE_PLAY_RECOVERY_CONFLICT',
  ],
  [
    'halted rollout',
    [{ status: 'halted', userFraction: 0.1, versionCodes: ['144'] }],
    'EAS_GOOGLE_PLAY_RECOVERY_CONFLICT',
  ],
  [
    'retained APKs',
    [{ status: 'completed', versionCodes: ['143', '144'] }],
    'EAS_GOOGLE_PLAY_RECOVERY_CONFLICT',
  ],
  [
    'multiple releases',
    [
      { status: 'completed', versionCodes: ['143'] },
      { status: 'completed', versionCodes: ['144'] },
    ],
    'EAS_GOOGLE_PLAY_RECOVERY_CONFLICT',
  ],
  [
    'unknown settings',
    [{ status: 'completed', versionCodes: ['144'], countryTargeting: { countries: ['PL'] } }],
    'EAS_GOOGLE_PLAY_RECOVERY_CONFLICT',
  ],
] as const)('does not overwrite %s during recovery', async (_scenario, releases, code) => {
  duplicateUpload('aab', { bundles: [{ versionCode: 145, sha256: binarySha256 }] });
  api().get(`${editPath}/tracks/internal`).reply(200, { track: 'internal', releases });
  api().delete(editPath).reply(204);
  const task = submission();
  await expect(task.run()).rejects.toMatchObject({ errorCode: code });
  expect(task.setters[0]).not.toHaveBeenCalled();
});

it('applies the requested rollout, changelog and review setting to a reused artifact', async () => {
  duplicateUpload('aab', { bundles: [{ versionCode: 145, sha256: binarySha256.toUpperCase() }] });
  api().get(`${editPath}/tracks/beta`).reply(200, { track: 'beta' });
  api()
    .put(`${editPath}/tracks/beta`, {
      track: 'beta',
      releases: [
        {
          status: 'inProgress',
          userFraction: 0.25,
          versionCodes: ['145'],
          releaseNotes: [{ language: 'en-US', text: 'Fix startup' }],
        },
      ],
    })
    .reply(200, { track: 'beta' });
  api()
    .post(`${editPath}:commit`)
    .query({ changesNotSentForReview: 'true' })
    .reply(200, { id: 'edit' });
  const task = submission({
    track: 'beta',
    rollout: 0.25,
    changelog: 'Fix startup',
    changes_not_sent_for_review: true,
  });
  await task.run();
  expect(task.setters[0]).toHaveBeenCalledWith('145');
});

it.each([409, 503])('does not retry recovery after HTTP %s at commit', async status => {
  duplicateUpload('aab', { bundles: [{ versionCode: 145, sha256: binarySha256 }] });
  api().get(`${editPath}/tracks/internal`).reply(200, { track: 'internal' });
  api().put(`${editPath}/tracks/internal`).reply(200, { track: 'internal' });
  api()
    .post(`${editPath}:commit`)
    .query({})
    .reply(status, { error: { message: 'edit invalidated or commit unavailable' } });
  if (status === 409) {
    api().delete(editPath).reply(204);
  }
  const task = submission();
  await expect(task.run()).rejects.toMatchObject({ cause: expect.objectContaining({ status }) });
  expect(task.setters[0]).not.toHaveBeenCalled();
});

it('stops recovery when the track cannot be read', async () => {
  duplicateUpload('aab', { bundles: [{ versionCode: 145, sha256: binarySha256 }] });
  api().get(`${editPath}/tracks/internal`).reply(503);
  api().delete(editPath).reply(204);
  const task = submission();
  await expect(task.run()).rejects.toMatchObject({
    cause: expect.objectContaining({ status: 503 }),
  });
  expect(task.setters[0]).not.toHaveBeenCalled();
});

it.each([
  ['completed', undefined, { status: 'completed' }],
  ['completed', 0, 'invalid'],
  ['completed', 0.25, { status: 'inProgress', userFraction: 0.25 }],
  ['completed', 1, { status: 'completed' }],
  ['draft', undefined, { status: 'draft' }],
  ['draft', 0, 'invalid'],
  ['draft', 0.25, 'invalid'],
  ['draft', 1, 'invalid'],
  ['halted', undefined, 'invalid'],
  ['halted', 0, 'invalid'],
  ['halted', 0.25, 'invalid'],
  ['halted', 1, 'invalid'],
  ['inProgress', undefined, 'invalid'],
  ['inProgress', 0, 'invalid'],
  ['inProgress', 0.25, { status: 'inProgress', userFraction: 0.25 }],
  ['inProgress', 1, { status: 'completed' }],
] as const)('validates and submits %s with rollout %s', async (status, rollout, expected) => {
  const task = submission({
    release_status: status,
    ...(rollout !== undefined ? { rollout } : {}),
  });
  if (expected === 'invalid') {
    await expect(task.run()).rejects.toThrow(status === 'halted' ? /release_status/ : /rollout/);
    expect(task.setters.every(set => set.mock.calls.length === 0)).toBe(true);
    return;
  }
  upload();
  api()
    .put(`${editPath}/tracks/internal`, {
      track: 'internal',
      releases: [{ ...expected, versionCodes: ['145'] }],
    })
    .reply(200, { track: 'internal' });
  api()
    .post(`${editPath}:commit`)
    .query({})
    .reply(() => {
      expect(task.setters.every(set => set.mock.calls.length === 0)).toBe(true);
      return [200, { id: 'edit' }];
    });
  await task.run();
  expect(task.setters.map(set => set.mock.calls)).toEqual([[['145']]]);
});
it('runs the step with a string rollout and validates its required output', async () => {
  upload();
  api()
    .put(`${editPath}/tracks/internal`, {
      track: 'internal',
      releases: [{ status: 'inProgress', userFraction: 0.25, versionCodes: ['145'] }],
    })
    .reply(200, { track: 'internal' });
  api().post(`${editPath}:commit`).query({}).reply(200, { id: 'edit' });
  const { step } = submission({ rollout: '0.25' });
  expect(step.__hookId).toBe('submit');
  await step.executeAsync();
  expect(step.outputs[0].value).toBe('145');
});
it.each(['upload', 'track', 'abort'] as const)(
  'deletes the edit after %s failure and leaves outputs unset',
  async failure => {
    const controller = new AbortController();
    const task = submission({}, controller.signal);
    mockToken();
    api().post(createPath).reply(200, { id: 'edit' });
    api()
      .post(`/upload${editPath}/bundles`)
      .query({ uploadType: 'resumable' })
      .reply(() => {
        if (failure === 'abort') {
          controller.abort(new Error('step timed out'));
        }
        return failure === 'upload'
          ? [400, { error: { message: 'rejected binary' } }]
          : [200, '', { Location: `https://androidpublisher.googleapis.com${session}` }];
      });
    if (failure === 'track') {
      nock('https://androidpublisher.googleapis.com').put(session).reply(200, { versionCode: 145 });
      api()
        .put(`${editPath}/tracks/internal`)
        .reply(400, { error: { message: 'unknown track' } });
    }
    api().delete(editPath).reply(204);
    await expect(task.run()).rejects.toThrow();
    expect(task.setters.every(set => set.mock.calls.length === 0)).toBe(true);
  }
);
it('preserves the original failure when cleanup fails', async () => {
  upload();
  api()
    .put(`${editPath}/tracks/internal`)
    .reply(400, { error: { message: 'unknown track' } });
  api().delete(editPath).reply(500);
  await expect(submission().run()).rejects.toMatchObject({
    cause: expect.objectContaining({ apiMessage: 'unknown track' }),
  });
});
it('does not delete the edit or publish outputs when commit outcome is unknown', async () => {
  upload();
  api().put(`${editPath}/tracks/internal`).reply(200, { track: 'internal' });
  api().post(`${editPath}:commit`).query(true).reply(503);
  let deleted = false;
  api()
    .delete(editPath)
    .optionally()
    .reply(() => {
      deleted = true;
      return [204];
    });
  const task = submission();
  await expect(task.run()).rejects.toBeInstanceOf(SystemError);
  expect(deleted).toBe(false);
  expect(task.setters.every(set => set.mock.calls.length === 0)).toBe(true);
});
it('reports a missing service-account file with its path', async () => {
  const missing = path.join(directory, 'missing.json');
  await expect(submission({ service_account_key_path: missing }).run()).rejects.toThrow(
    `Service-account key file not found at ${missing}`
  );
});
it('does not expose invalid credential contents', async () => {
  await fs.writeFile(keyPath, 'PRIVATE_SECRET_INVALID_JSON');
  const error = await submission()
    .run()
    .catch(error => error);
  expect(error).toBeInstanceOf(UserError);
  expect(JSON.stringify(error) + String(error)).not.toContain('PRIVATE_SECRET');
});

it('preserves the cause when the service-account file cannot be read', async () => {
  const cause = Object.assign(new Error('permission denied'), { code: 'EACCES' });
  const read = jest.spyOn(fs, 'readFile').mockRejectedValueOnce(cause);
  try {
    await expect(submission().run()).rejects.toMatchObject({ cause });
  } finally {
    read.mockRestore();
  }
});

it('logs a formatted rollout and confirms the track update before committing', async () => {
  upload();
  const task = submission({ rollout: 0.29 });
  const info = jest.spyOn(task.step.ctx.logger, 'info');
  const updatedMessage = 'Updated Google Play track "internal" in the edit.';
  let loggedBeforeUpdate = false;
  let messagesBeforeCommit: unknown[] = [];
  api()
    .put(`${editPath}/tracks/internal`)
    .reply(() => {
      loggedBeforeUpdate = info.mock.calls.some(([message]) => message === updatedMessage);
      return [200, { track: 'internal' }];
    });
  api()
    .post(`${editPath}:commit`)
    .query({})
    .reply(() => {
      messagesBeforeCommit = info.mock.calls.map(([message]) => message);
      return [200, { id: 'edit' }];
    });
  await task.run();
  expect(info).toHaveBeenCalledWith('Release status: inProgress. Rollout: 29%.');
  expect(loggedBeforeUpdate).toBe(false);
  expect(messagesBeforeCommit.slice(-2)).toEqual([
    updatedMessage,
    'Committing the Google Play edit...',
  ]);
});
