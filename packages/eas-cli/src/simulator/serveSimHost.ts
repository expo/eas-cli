import WebSocket from 'ws';

import fetch, { httpsProxyAgent } from '../fetch';
import { DeviceRunSessionRemoteConfig } from './utils';

const SERVE_SIM_TOKEN_SUBPROTOCOL_PREFIX = 'serve-sim.token.';
const DEFAULT_ACTION_TIMEOUT_MS = 60_000;

export type ServeSimHost = {
  apiUrl: string;
  token: string;
};

export type ServeSimHostActionResult = {
  stdout: string;
  stderr: string;
};

export class UnsupportedServeSimHostActionError extends Error {}

export function getServeSimHost(remoteConfig: DeviceRunSessionRemoteConfig): ServeSimHost | null {
  switch (remoteConfig.__typename) {
    case 'ServeSimRunSessionRemoteConfig':
    case 'WebPreviewOnlyRunSessionRemoteConfig':
      return remoteConfig.previewApiUrl && remoteConfig.previewToken
        ? { apiUrl: remoteConfig.previewApiUrl, token: remoteConfig.previewToken }
        : null;
    case 'AgentDeviceRunSessionRemoteConfig':
    case 'ArgentRunSessionRemoteConfig':
    case 'AppiumRunSessionRemoteConfig':
      return remoteConfig.previewApiUrl && remoteConfig.webPreviewToken
        ? { apiUrl: remoteConfig.previewApiUrl, token: remoteConfig.webPreviewToken }
        : null;
  }
}

export async function getServeSimDeviceUdidAsync(host: ServeSimHost): Promise<string> {
  const response = await fetch(resolveServeSimUrl(host.apiUrl, 'api').toString(), {
    headers: { Authorization: `Bearer ${host.token}` },
  });
  const state = (await response.json()) as { device?: unknown } | null;
  if (typeof state?.device !== 'string' || state.device.length === 0) {
    throw new Error('The simulator session has no running simulator.');
  }
  return state.device;
}

export async function runServeSimHostActionAsync(
  host: ServeSimHost,
  action: string,
  params: Record<string, unknown>,
  { timeoutMs = DEFAULT_ACTION_TIMEOUT_MS }: { timeoutMs?: number } = {}
): Promise<ServeSimHostActionResult> {
  const url = resolveServeSimUrl(host.apiUrl, 'exec-ws');
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return await new Promise<ServeSimHostActionResult>((resolve, reject) => {
    const socket = new WebSocket(
      url.toString(),
      [SERVE_SIM_TOKEN_SUBPROTOCOL_PREFIX + host.token],
      {
        ...(httpsProxyAgent ? { agent: httpsProxyAgent } : {}),
      }
    );
    let settled = false;
    let sent = false;
    const finish = (error: Error | null, result?: ServeSimHostActionResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      socket.terminate();
      if (error) {
        reject(error);
      } else {
        resolve(result!);
      }
    };
    const timer = setTimeout(() => {
      finish(new Error(`Timed out waiting for the simulator host to run ${action}.`));
    }, timeoutMs);
    socket.on('error', error => {
      finish(new Error(`Could not connect to the simulator host: ${error.message}`));
    });
    socket.on('close', () => {
      finish(
        new Error(
          sent
            ? `The simulator host closed the connection before ${action} finished.`
            : 'The simulator host rejected the session token.'
        )
      );
    });
    socket.on('message', data => {
      let reply: any;
      try {
        reply = JSON.parse(data.toString());
      } catch {
        finish(new Error('The simulator host sent an invalid response.'));
        return;
      }
      if (reply?.ready === true && !sent) {
        sent = true;
        socket.send(JSON.stringify({ id: 1, action, params }));
        return;
      }
      if (reply?.id !== 1 || !sent) {
        return;
      }
      if (typeof reply.error === 'string') {
        finish(
          reply.error === `unknown action ${action}`
            ? new UnsupportedServeSimHostActionError(
                `This simulator session does not support ${action} yet. Start a new session to use it.`
              )
            : new Error(`${action} failed: ${reply.error}`)
        );
        return;
      }
      const stdout = typeof reply.stdout === 'string' ? reply.stdout : '';
      const stderr = typeof reply.stderr === 'string' ? reply.stderr : '';
      if (reply.exitCode !== 0) {
        finish(new Error(`${action} failed: ${stderr.trim() || `exit code ${reply.exitCode}`}`));
        return;
      }
      finish(null, { stdout, stderr });
    });
  });
}

function resolveServeSimUrl(apiUrl: string, route: string): URL {
  return new URL(route, apiUrl.endsWith('/') ? apiUrl : `${apiUrl}/`);
}
