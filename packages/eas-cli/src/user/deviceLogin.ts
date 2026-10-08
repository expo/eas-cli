import JsonFile from '@expo/json-file';
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
const terminalErrorSchema = z.enum(['access_denied', 'expired_token', 'invalid_grant']);
const tokenSchema = z.union([
  z.object({ session_secret: z.string().min(1), expires_at: z.iso.datetime() }),
  z.object({ error: z.literal('matching_required'), match_options: z.array(z.string()).min(1) }),
  z.object({ error: z.enum(['authorization_pending', 'slow_down']).or(terminalErrorSchema) }),
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

type PendingDeviceLogin = {
  request_id: string;
  verification_uri: string;
  verification_uri_complete: string;
  user_code: string;
  expires_at: string;
  retry_after: number;
};

export type DeviceLoginResult =
  | { request_id: string; status: 'authenticated'; username: string }
  | { request_id: string; status: z.infer<typeof terminalErrorSchema> }
  | (PendingDeviceLogin &
      (
        | { status: 'authorization_pending' | 'slow_down' }
        | { status: 'matching_required'; match_options: string[] }
      ));

export function isDeviceLoginFailure(result: {
  status: string;
}): result is { status: z.infer<typeof terminalErrorSchema> } {
  return terminalErrorSchema.safeParse(result.status).success;
}

function getRequestPath(requestId: string): string {
  if (!z.uuid().safeParse(requestId).success) {
    throw new Error('Invalid device login request ID. Start again with eas login --device.');
  }
  return path.join(path.dirname(getStateJsonPath()), 'device-login', `${requestId}.json`);
}

async function postAsync(endpoint: string, body: object): Promise<unknown> {
  const response = await fetch(`${getExpoApiBaseUrl()}/v2/auth/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: 'eas-cli', ...body }),
    timeout: 30_000,
  });
  return (await response.json()).data;
}

function publicResult(
  requestId: string,
  state: DeviceLoginState
): PendingDeviceLogin & { status: 'authorization_pending' } {
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

export async function startDeviceLoginAsync(): Promise<
  PendingDeviceLogin & { status: 'authorization_pending' }
> {
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
  // JsonFile preserves this mode when atomically replacing the file on subsequent writes.
  await fs.writeFile(requestPath, '{}', { mode: 0o600, flag: 'wx' });
  await JsonFile.writeAsync(requestPath, state);
  return publicResult(requestId, state);
}

// Resume one request at a time, as with other CLI session updates. State survives between
// invocations; concurrent commands for the same request are not serialized.
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
  const parsed = stateSchema.safeParse(await JsonFile.readAsync(requestPath));
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
    // Persist the deadline before polling so errors and process restarts respect the interval.
    state.nextPollAt = Date.now() + state.interval * 1000;
    await JsonFile.writeAsync(requestPath, state);
    let data: unknown;
    let retryAfter = 0;
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
      const header = error.response.headers.get('retry-after');
      const seconds = header ? Number(header) : NaN;
      const delay = Number.isFinite(seconds)
        ? seconds
        : (Date.parse(header ?? '') - Date.now()) / 1000;
      retryAfter = Number.isFinite(delay) ? delay : 60;
      data = { error: 'slow_down' };
    }
    const result = tokenSchema.safeParse(data);
    if (!result.success) {
      throw new Error('Unexpected device token response. Resume this request to retry.');
    }
    if ('error' in result.data) {
      const response = result.data;
      const failure = { request_id: requestId, status: response.error };
      if (isDeviceLoginFailure(failure)) {
        await fs.remove(requestPath);
        return failure;
      }
      switch (response.error) {
        case 'slow_down':
          state.interval += 5;
          state.nextPollAt = Date.now() + Math.max(state.interval, retryAfter) * 1000;
          await JsonFile.writeAsync(requestPath, state);
          return { ...publicResult(requestId, state), status: 'slow_down' };
        case 'matching_required':
          return {
            ...publicResult(requestId, state),
            status: response.error,
            match_options: response.match_options,
          };
      }
      return publicResult(requestId, state);
    }
    // The grant is single-use. Persist its secret before fetching the user/installing the
    // session, so a later invocation can finish if those operations fail.
    state.sessionSecret = result.data.session_secret;
    state.expiresAt = Date.parse(result.data.expires_at);
    await JsonFile.writeAsync(requestPath, state);
  }
  const username = await sessionManager.loginWithDeviceSessionAsync(state.sessionSecret);
  await fs.remove(requestPath);
  return { request_id: requestId, status: 'authenticated', username };
}
