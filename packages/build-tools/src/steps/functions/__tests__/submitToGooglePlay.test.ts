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
const statuses = ['completed', 'draft', 'halted', 'inProgress'];
const rollouts = [undefined, 0, 0.25, 1];
it.each(statuses.flatMap(status => rollouts.map(rollout => [status, rollout] as const)))(
  'validates and submits %s with rollout %s',
  async (status, rollout) => {
    const task = submission({
      release_status: status,
      ...(rollout !== undefined ? { rollout } : {}),
    });
    const invalid =
      rollout === 0 ||
      ((status === 'draft' || status === 'halted') && rollout !== undefined) ||
      (status === 'inProgress' && rollout === undefined);
    if (invalid) {
      await expect(task.run()).rejects.toThrow(/rollout/);
      expect(task.setters.every(set => set.mock.calls.length === 0)).toBe(true);
      return;
    }
    upload();
    const expected =
      rollout === 0.25
        ? { status: 'inProgress', userFraction: 0.25 }
        : { status: status === 'inProgress' ? 'completed' : status };
    api()
      .put(`${editPath}/tracks/internal`, {
        track: 'internal',
        releases: [{ ...expected, versionCodes: ['145'] }],
      })
      .reply(200, { track: 'internal' });
    api()
      .post(`${editPath}:commit`)
      .query({ changesNotSentForReview: 'false' })
      .reply(() => {
        expect(task.setters.every(set => set.mock.calls.length === 0)).toBe(true);
        return [200, { id: 'edit' }];
      });
    await task.run();
    expect(task.setters.map(set => set.mock.calls)).toEqual([[['145']]]);
  }
);
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
it('does not publish outputs when commit outcome is unknown', async () => {
  upload();
  api().put(`${editPath}/tracks/internal`).reply(200, { track: 'internal' });
  api().post(`${editPath}:commit`).query(true).reply(503);
  api().delete(editPath).reply(204);
  const task = submission();
  await expect(task.run()).rejects.toBeInstanceOf(SystemError);
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
