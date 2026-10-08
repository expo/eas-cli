import fs from 'fs-extra';
import MockDate from 'mockdate';
import nock from 'nock';
import os from 'os';
import path from 'path';

import { getExpoApiBaseUrl } from '../../api';
import { getStateJsonPath } from '../../utils/paths';
import SessionManager from '../SessionManager';
import { resumeDeviceLoginAsync, startDeviceLoginAsync } from '../deviceLogin';
import { fetchUserAsync } from '../fetchUser';

jest.mock('../../utils/paths');
jest.mock('../fetchUser');

const apiUrl = getExpoApiBaseUrl();
const now = Date.parse('2026-09-29T12:00:00Z');
let directory: string;

function manager(): SessionManager {
  return new SessionManager({ logEvent: jest.fn(), setActor: jest.fn(), flushAsync: jest.fn() });
}

async function startAsync(): Promise<string> {
  nock(apiUrl)
    .post('/v2/auth/device_authorization', body => body.client_id === 'eas-cli')
    .reply(200, {
      data: {
        device_code: 'PRIVATE_DEVICE_CODE',
        user_code: 'BCDF-GHJK',
        verification_uri: 'https://expo.dev/oauth/device',
        expires_in: 600,
        interval: 5,
      },
    });
  const result = await startDeviceLoginAsync();
  expect(JSON.stringify(result)).not.toContain('PRIVATE_DEVICE_CODE');
  expect(result.verification_uri_complete).toBe(
    'https://expo.dev/oauth/device?user_code=BCDF-GHJK'
  );
  return result.request_id;
}

function token(data: object, match?: string): nock.Scope {
  return nock(apiUrl)
    .post('/v2/auth/token', {
      client_id: 'eas-cli',
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: 'PRIVATE_DEVICE_CODE',
      ...(match ? { match_value: match } : {}),
    })
    .reply(200, { data });
}

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-device-login-test-'));
  jest.mocked(getStateJsonPath).mockReturnValue(path.join(directory, 'state.json'));
  jest.mocked(fetchUserAsync).mockResolvedValue({ id: 'user-id', username: 'demo-user' });
  MockDate.set(now);
  nock.disableNetConnect();
});

afterEach(async () => {
  const pending = nock.pendingMocks();
  nock.cleanAll();
  nock.enableNetConnect();
  MockDate.reset();
  jest.restoreAllMocks();
  jest.clearAllMocks();
  await fs.remove(directory);
  expect(pending).toEqual([]);
});

it('resumes across fresh sessions, keeps secrets private, and installs a normal Expo session', async () => {
  await fs.writeJson(getStateJsonPath(), { unrelatedSetting: true });
  const id = await startAsync();
  const requestPath = path.join(directory, 'device-login', `${id}.json`);
  expect((await fs.stat(requestPath)).mode & 0o777).toBe(0o600);
  expect((await fs.stat(path.dirname(requestPath))).mode & 0o777).toBe(0o700);
  MockDate.set(now + 5000);
  token({ error: 'authorization_pending' });
  expect((await resumeDeviceLoginAsync(id, manager())).status).toBe('authorization_pending');
  expect((await fs.stat(requestPath)).mode & 0o777).toBe(0o600);
  MockDate.set(now + 10000);
  token({ error: 'matching_required', match_options: ['12', '42', '87'] });
  expect(await resumeDeviceLoginAsync(id, manager())).toMatchObject({
    status: 'matching_required',
    match_options: ['12', '42', '87'],
  });
  MockDate.set(now + 15000);
  token({ session_secret: 'PRIVATE_SESSION', expires_at: '2027-01-01T00:00:00Z' }, '42');
  expect(await resumeDeviceLoginAsync(id, manager(), '42')).toEqual({
    request_id: id,
    status: 'authenticated',
    username: 'demo-user',
  });
  expect(await fs.readJson(getStateJsonPath())).toEqual({
    unrelatedSetting: true,
    auth: {
      sessionSecret: 'PRIVATE_SESSION',
      userId: 'user-id',
      username: 'demo-user',
      currentConnection: 'Browser-Flow-Authentication',
    },
  });
  expect(await fs.readdir(path.dirname(requestPath))).toEqual([]);
});

it('accepts a direct session secret without a matching response', async () => {
  const id = await startAsync();
  MockDate.set(now + 5000);
  token({ session_secret: 'PRIVATE_SESSION', expires_at: '2027-01-01T00:00:00Z' });
  expect(await resumeDeviceLoginAsync(id, manager())).toEqual({
    request_id: id,
    status: 'authenticated',
    username: 'demo-user',
  });
  expect(await fs.readJson(getStateJsonPath())).toMatchObject({
    auth: { sessionSecret: 'PRIVATE_SESSION' },
  });
  expect(await fs.readdir(path.join(directory, 'device-login'))).toEqual([]);
});

it('keeps the poll interval across invocations, including slow_down', async () => {
  const id = await startAsync();
  expect(await resumeDeviceLoginAsync(id, manager())).toMatchObject({ retry_after: 5 });
  MockDate.set(now + 5000);
  token({ error: 'slow_down' });
  expect(await resumeDeviceLoginAsync(id, manager())).toMatchObject({
    status: 'slow_down',
    retry_after: 10,
  });
  MockDate.set(now + 6000);
  expect(await resumeDeviceLoginAsync(id, manager())).toMatchObject({ retry_after: 9 });
});

it.each([
  { header: '30', delay: 30 },
  { header: new Date(now + 35000).toUTCString(), delay: 30 },
  { header: undefined, delay: 60 },
  { header: 'invalid', delay: 60 },
])('honors HTTP 429 Retry-After ($header) across invocations', async ({ header, delay }) => {
  const id = await startAsync();
  MockDate.set(now + 5000);
  nock(apiUrl)
    .post('/v2/auth/token')
    .reply(429, {}, header ? { 'Retry-After': header } : {});
  expect(await resumeDeviceLoginAsync(id, manager())).toMatchObject({
    status: 'slow_down',
    retry_after: delay,
  });
  expect(await resumeDeviceLoginAsync(id, manager())).toMatchObject({ retry_after: delay });
});

it('expires without a network call and removes the private request', async () => {
  const id = await startAsync();
  MockDate.set(now + 600000);
  expect((await resumeDeviceLoginAsync(id, manager())).status).toBe('expired_token');
  await expect(resumeDeviceLoginAsync(id, manager())).rejects.toThrow('not found');
});

it.each(['access_denied', 'expired_token', 'invalid_grant'])(
  'stops on %s without retrying or choosing another number',
  async error => {
    const id = await startAsync();
    MockDate.set(now + 5000);
    token({ error }, '12');
    expect((await resumeDeviceLoginAsync(id, manager(), '12')).status).toBe(error);
    await expect(resumeDeviceLoginAsync(id, manager(), '42')).rejects.toThrow('not found');
    expect(fetchUserAsync).not.toHaveBeenCalled();
  }
);

it('recovers after token exchange succeeds but fetching the user fails', async () => {
  const id = await startAsync();
  MockDate.set(now + 5000);
  token({ session_secret: 'PRIVATE_SESSION', expires_at: '2027-01-01T00:00:00Z' }, '42');
  jest.mocked(fetchUserAsync).mockRejectedValueOnce(new Error('offline'));
  await expect(resumeDeviceLoginAsync(id, manager(), '42')).rejects.toThrow('offline');
  const requestPath = path.join(directory, 'device-login', `${id}.json`);
  expect((await fs.stat(requestPath)).mode & 0o777).toBe(0o600);
  expect((await fs.readJson(requestPath)).sessionSecret).toBe('PRIVATE_SESSION');
  // No second token exchange; the one-use grant was already consumed.
  expect((await resumeDeviceLoginAsync(id, manager())).status).toBe('authenticated');
});

it('rejects another API environment, invalid request IDs, and invalid number input', async () => {
  const id = await startAsync();
  const requestPath = path.join(directory, 'device-login', `${id}.json`);
  const state = await fs.readJson(requestPath);
  await fs.writeJson(requestPath, { ...state, apiUrl: 'https://another.example.com' });
  await expect(resumeDeviceLoginAsync(id, manager())).rejects.toThrow('same Expo API environment');
  await expect(resumeDeviceLoginAsync('../state', manager())).rejects.toThrow(
    'Invalid device login request ID'
  );
  await expect(resumeDeviceLoginAsync(id, manager(), 'guess')).rejects.toThrow(
    'number the user sees'
  );
});

it('preserves a pending request after a network failure', async () => {
  const id = await startAsync();
  MockDate.set(now + 5000);
  nock(apiUrl).post('/v2/auth/token').replyWithError('offline');
  await expect(resumeDeviceLoginAsync(id, manager())).rejects.toThrow('offline');
  MockDate.set(now + 10000);
  token({ error: 'matching_required', match_options: ['12', '42', '87'] });
  expect((await resumeDeviceLoginAsync(id, manager())).status).toBe('matching_required');
});
