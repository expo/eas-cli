import { randomUUID } from 'crypto';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { z } from 'zod';

import SessionManager from './SessionManager';
import { getExpoApiBaseUrl } from '../api';
import fetch, { RequestError } from '../fetch';
import { getStateJsonPath } from '../utils/paths';

const grantSchema = z.object({
  device_code: z.string().min(1),
  user_code: z.string().min(1),
  verification_uri: z.url(),
  expires_in: z.number().positive(),
  interval: z.number().positive(),
});
const tokenSchema = z.union([
  z.object({ session_secret: z.string().min(1), expires_at: z.iso.datetime() }),
  z.object({ error: z.literal('matching_required'), match_options: z.array(z.string()).min(1) }),
  z.object({
    error: z.enum([
      'authorization_pending',
      'slow_down',
      'access_denied',
      'expired_token',
      'invalid_grant',
    ]),
  }),
]);
const stateSchema = z.object({
  apiUrl: z.string(),
  deviceCode: z.string(),
  userCode: z.string(),
  verificationUri: z.string(),
  expiresAt: z.number(),
  interval: z.number(),
  nextPollAt: z.number(),
  sessionSecret: z.string().optional(),
});
type DeviceLoginState = z.infer<typeof stateSchema>;

export type DeviceLoginResult = {
  request_id: string;
  status:
    | 'authorization_pending'
    | 'matching_required'
    | 'slow_down'
    | 'authenticated'
    | 'access_denied'
    | 'expired_token'
    | 'invalid_grant';
  verification_uri?: string;
  verification_uri_complete?: string;
  user_code?: string;
  expires_at?: string;
  retry_after?: number;
  match_options?: string[];
  username?: string;
};

function getRequestPath(requestId: string): string {
  if (!z.uuid().safeParse(requestId).success) {
    throw new Error('Invalid device login request ID. Start again with eas login --device.');
  }
  return path.join(path.dirname(getStateJsonPath()), 'device-login', `${requestId}.json`);
}

async function saveAsync(requestPath: string, state: DeviceLoginState): Promise<void> {
  const temporaryPath = `${requestPath}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporaryPath, JSON.stringify(state), { mode: 0o600, flag: 'wx' });
    await fs.rename(temporaryPath, requestPath);
  } finally {
    await fs.remove(temporaryPath);
  }
}

async function postAsync(endpoint: string, body: object): Promise<unknown> {
  const response = await fetch(`${getExpoApiBaseUrl()}/v2/auth/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: 'eas-cli', ...body }),
    timeout: 30_000,
  }).catch(async error => {
    if (error instanceof RequestError && error.response.status === 400) {
      const responseBody = await error.response
        .clone()
        .json()
        .catch(() => ({}));
      if (
        responseBody.errors?.some(
          (entry: { message?: string }) =>
            entry.message === 'eas-cli is not permitted to use the device authorization grant.'
        )
      ) {
        throw new Error(
          'Device login is not enabled for EAS CLI on this server yet. The device grant configuration must be deployed before using --device.'
        );
      }
    }
    throw error;
  });
  return (await response.json()).data;
}

function publicResult(requestId: string, state: DeviceLoginState): DeviceLoginResult {
  const verificationUrl = new URL(state.verificationUri);
  verificationUrl.searchParams.set('user_code', state.userCode);
  return {
    request_id: requestId,
    status: 'authorization_pending',
    verification_uri: state.verificationUri,
    verification_uri_complete: verificationUrl.toString(),
    user_code: state.userCode,
    expires_at: new Date(state.expiresAt).toISOString(),
    retry_after: Math.max(0, Math.ceil((state.nextPollAt - Date.now()) / 1000)),
  };
}

export async function startDeviceLoginAsync(): Promise<DeviceLoginResult> {
  const result = grantSchema.safeParse(
    await postAsync('device_authorization', {
      device_name: os.hostname().slice(0, 255),
      device_platform: os.platform(),
      device_os_version: os.release().slice(0, 64),
    })
  );
  if (!result.success) {
    throw new Error('Unexpected device authorization response. Try again or update EAS CLI.');
  }
  const grant = result.data;
  const requestId = randomUUID();
  const requestPath = getRequestPath(requestId);
  await fs.mkdir(path.dirname(requestPath), { recursive: true, mode: 0o700 });
  const state: DeviceLoginState = {
    apiUrl: getExpoApiBaseUrl(),
    deviceCode: grant.device_code,
    userCode: grant.user_code,
    verificationUri: grant.verification_uri,
    expiresAt: Date.now() + grant.expires_in * 1000,
    interval: Math.max(5, grant.interval),
    nextPollAt: Date.now() + Math.max(5, grant.interval) * 1000,
  };
  await saveAsync(requestPath, state);
  return publicResult(requestId, state);
}

// Serialize resumes. A process killed between chat turns must not leave an unusable lock.
async function lockAsync(lockPath: string): Promise<void> {
  try {
    await fs.writeFile(lockPath, String(process.pid), { flag: 'wx', mode: 0o600 });
  } catch (error: any) {
    if (error.code !== 'EEXIST') {
      throw error;
    }
    const pid = Number(await fs.readFile(lockPath, 'utf8'));
    try {
      if (!Number.isSafeInteger(pid) || pid <= 0) {
        throw new Error('Invalid login lock');
      }
      process.kill(pid, 0);
    } catch (probeError: any) {
      if (probeError.code === 'ESRCH') {
        await fs.remove(lockPath);
        await fs.writeFile(lockPath, String(process.pid), { flag: 'wx', mode: 0o600 });
        return;
      }
    }
    throw new Error(
      'This device login is already being resumed by another process. Try again later.'
    );
  }
}

export async function resumeDeviceLoginAsync(
  requestId: string,
  sessionManager: SessionManager,
  match?: string
): Promise<DeviceLoginResult> {
  if (match !== undefined && !/^\d{1,8}$/.test(match)) {
    throw new Error('--match must be the number the user sees in their browser.');
  }
  const requestPath = getRequestPath(requestId);
  if (!(await fs.pathExists(requestPath))) {
    throw new Error('Device login request not found. Start again with eas login --device.');
  }
  const lockPath = `${requestPath}.lock`;
  await lockAsync(lockPath);
  try {
    const parsed = stateSchema.safeParse(await fs.readJson(requestPath));
    if (!parsed.success) {
      throw new Error('Invalid saved device login. Start again with eas login --device.');
    }
    const state = parsed.data;
    if (state.apiUrl !== getExpoApiBaseUrl()) {
      throw new Error('Resume device login in the same Expo API environment where it was started.');
    }
    if (state.expiresAt <= Date.now()) {
      await fs.remove(requestPath);
      return { request_id: requestId, status: 'expired_token' };
    }
    if (!state.sessionSecret) {
      if (state.nextPollAt > Date.now()) {
        return publicResult(requestId, state);
      }
      // Save the poll deadline before making the request so it survives process restarts/errors.
      state.nextPollAt = Date.now() + state.interval * 1000;
      await saveAsync(requestPath, state);
      let data: unknown;
      try {
        data = await postAsync('token', {
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          device_code: state.deviceCode,
          ...(match !== undefined ? { match_value: match } : {}),
        });
      } catch (error) {
        if (!(error instanceof RequestError) || error.response.status !== 429) {
          throw error;
        }
        const retryAfter = error.response.headers.get('retry-after');
        const seconds = retryAfter ? Number(retryAfter) : NaN;
        const delay = Number.isFinite(seconds)
          ? seconds
          : (Date.parse(retryAfter ?? '') - Date.now()) / 1000;
        state.interval += 5;
        state.nextPollAt =
          Date.now() + Math.max(state.interval, Number.isFinite(delay) ? delay : 60) * 1000;
        await saveAsync(requestPath, state);
        return { ...publicResult(requestId, state), status: 'slow_down' };
      }
      const result = tokenSchema.safeParse(data);
      if (!result.success) {
        throw new Error('Unexpected device token response. Resume this request to retry.');
      }
      if ('error' in result.data) {
        const response = result.data;
        if (['access_denied', 'expired_token', 'invalid_grant'].includes(response.error)) {
          await fs.remove(requestPath);
          return { request_id: requestId, status: response.error };
        }
        if (response.error === 'slow_down') {
          state.interval += 5;
          state.nextPollAt = Date.now() + state.interval * 1000;
          await saveAsync(requestPath, state);
        }
        return {
          ...publicResult(requestId, state),
          status: response.error,
          ...('match_options' in response ? { match_options: response.match_options } : {}),
        };
      }
      // The grant is consumed once. Save the returned secret before any fallible user lookup
      // or final session write, allowing a later process to finish installing this session.
      state.sessionSecret = result.data.session_secret;
      state.expiresAt = Date.parse(result.data.expires_at);
      await saveAsync(requestPath, state);
    }
    const username = await sessionManager.loginWithDeviceSessionAsync(state.sessionSecret);
    await fs.remove(requestPath);
    return { request_id: requestId, status: 'authenticated', username };
  } finally {
    await fs.remove(lockPath);
  }
}
