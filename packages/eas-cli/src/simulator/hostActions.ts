import WebSocket from 'ws';
import { z } from 'zod';

import fetch, { RequestError, httpsProxyAgent } from '../fetch';
import { DeviceRunSessionByIdQuery } from '../graphql/generated';

type DeviceRunSessionRemoteConfig = NonNullable<
  DeviceRunSessionByIdQuery['deviceRunSessions']['byId']['remoteConfig']
>;

export interface PreviewApiAccess {
  apiUrl: string;
  token: string;
}

export interface HostActionRequest {
  action: string;
  params: Record<string, unknown>;
}

export interface HostActionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

const SETTINGS = {
  'hardware-keyboard': 'hardwareKeyboard',
  'reduce-motion': 'reduceMotion',
  'increase-contrast': 'increaseContrast',
  'reduce-transparency': 'reduceTransparency',
  voiceover: 'voiceover',
  'liquid-glass': 'liquidGlass',
  'color-filter': 'colorFilter',
  'text-size': 'textSize',
  'show-borders': 'showBorders',
} as const;

const COMMANDS = {
  settings: { action: 'settings.status', usage: 'settings' },
  'software-keyboard': { action: 'softwareKeyboard.toggle', usage: 'software-keyboard' },
  'memory-warning': { action: 'memoryWarning', usage: 'memory-warning' },
  'ca-debug': {
    action: 'caDebug.set',
    usage: 'ca-debug <blended|copies|misaligned|offscreen|slow-animations> <on|off>',
  },
  hinge: { action: 'hinge.set', usage: 'hinge <fold|half|unfold|0-180>' },
  permissions: { action: 'permissions.list', usage: 'permissions [--bundle-id <id>]' },
  'event-log': { action: 'eventLog.list', usage: 'event-log [--limit <count>]' },
} as const;

export const HOST_ACTION_NAMES = [...Object.keys(SETTINGS), ...Object.keys(COMMANDS)];

export const JSON_OUTPUT_ACTIONS = new Set(['settings', 'permissions', 'event-log']);

const HOST_ACTION_TIMEOUT_MS = 30_000;

const PreviewConfig = z.object({ device: z.string().min(1) });

const SocketMessage = z.union([
  z.object({ ready: z.literal(true) }),
  z.object({ id: z.literal(1), error: z.string() }),
  z.object({
    id: z.literal(1),
    stdout: z.string(),
    stderr: z.string(),
    exitCode: z.number(),
  }),
]);

function isSetting(name: string): name is keyof typeof SETTINGS {
  return Object.hasOwn(SETTINGS, name);
}

export function formatHostActionUsage(): string {
  return [
    ...Object.keys(SETTINGS).map(name => `${name} [value]`),
    ...Object.values(COMMANDS).map(command => command.usage),
  ].join('\n');
}

export function resolveHostActionRequest(
  name: string,
  values: string[],
  options: { bundleId?: string; limit?: number } = {}
): HostActionRequest {
  if (isSetting(name)) {
    const setting = SETTINGS[name];
    if (values.length === 0) {
      return { action: `${setting}.get`, params: {} };
    }
    if (values.length === 1) {
      return { action: `${setting}.set`, params: { value: values[0] } };
    }
    throw invalidArgumentsError(name, `${name} [value]`);
  }
  switch (name) {
    case 'settings':
    case 'software-keyboard':
    case 'memory-warning':
      if (values.length > 0) {
        throw invalidArgumentsError(name, COMMANDS[name].usage);
      }
      return { action: COMMANDS[name].action, params: {} };
    case 'ca-debug':
      if (values.length !== 2) {
        throw invalidArgumentsError(name, COMMANDS[name].usage);
      }
      return { action: COMMANDS[name].action, params: { option: values[0], value: values[1] } };
    case 'hinge': {
      if (values.length !== 1) {
        throw invalidArgumentsError(name, COMMANDS[name].usage);
      }
      const angle = Number(values[0]);
      return {
        action: COMMANDS[name].action,
        params: { value: values[0] !== '' && Number.isFinite(angle) ? angle : values[0] },
      };
    }
    case 'permissions':
      if (values.length > 0) {
        throw invalidArgumentsError(name, COMMANDS[name].usage);
      }
      return {
        action: COMMANDS[name].action,
        params: options.bundleId ? { bundleId: options.bundleId } : {},
      };
    case 'event-log':
      if (values.length > 0) {
        throw invalidArgumentsError(name, COMMANDS[name].usage);
      }
      return {
        action: COMMANDS[name].action,
        params: options.limit !== undefined ? { limit: options.limit } : {},
      };
    default:
      throw new Error(
        `Unknown simulator action "${name}". Use one of: ${HOST_ACTION_NAMES.join(', ')}.`
      );
  }
}

function invalidArgumentsError(name: string, usage: string): Error {
  return new Error(`Wrong arguments for "${name}". Usage: eas simulator:action ${usage}`);
}

export function getPreviewApiAccess(
  remoteConfig: DeviceRunSessionRemoteConfig
): PreviewApiAccess | null {
  let token: string | null | undefined;
  switch (remoteConfig.__typename) {
    case 'ServeSimRunSessionRemoteConfig':
    case 'WebPreviewOnlyRunSessionRemoteConfig':
      token = remoteConfig.previewToken;
      break;
    case 'AgentDeviceRunSessionRemoteConfig':
    case 'ArgentRunSessionRemoteConfig':
    case 'AppiumRunSessionRemoteConfig':
      token = remoteConfig.webPreviewToken;
      break;
  }
  if (!remoteConfig.previewApiUrl || !token) {
    return null;
  }
  return { apiUrl: remoteConfig.previewApiUrl, token };
}

function previewEndpoint(apiUrl: string, path: string): URL {
  const base = new URL(apiUrl);
  base.search = '';
  base.hash = '';
  if (!base.pathname.endsWith('/')) {
    base.pathname += '/';
  }
  return new URL(path, base);
}

async function fetchSimulatorUdidAsync({ apiUrl, token }: PreviewApiAccess): Promise<string> {
  let response;
  try {
    response = await fetch(previewEndpoint(apiUrl, 'api').toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (error) {
    if (error instanceof RequestError && [401, 403].includes(error.response.status)) {
      throw new Error(
        `The simulator preview server refused the session token (HTTP ${error.response.status}). Run \`eas simulator:get\` to check that the session still runs, then try again.`
      );
    }
    throw error;
  }
  const config = PreviewConfig.safeParse(await response.json());
  if (!config.success) {
    throw new Error(
      'The simulator preview server did not report which simulator it streams. The session can still be starting. Wait a few seconds and run the command again.'
    );
  }
  return config.data.device;
}

export async function runHostActionAsync(
  access: PreviewApiAccess,
  request: HostActionRequest,
  { timeoutMs = HOST_ACTION_TIMEOUT_MS }: { timeoutMs?: number } = {}
): Promise<HostActionResult> {
  const udid = await fetchSimulatorUdidAsync(access);
  const socketUrl = previewEndpoint(access.apiUrl, 'exec-ws');
  socketUrl.protocol = socketUrl.protocol === 'https:' ? 'wss:' : 'ws:';

  return await new Promise<HostActionResult>((resolve, reject) => {
    const ws = new WebSocket(
      socketUrl.toString(),
      [`serve-sim.token.${access.token}`],
      httpsProxyAgent ? { agent: httpsProxyAgent } : {}
    );
    let settled = false;
    function settle(): boolean {
      if (settled) {
        return false;
      }
      settled = true;
      clearTimeout(timer);
      ws.close();
      return true;
    }
    function fail(error: Error): void {
      if (settle()) {
        reject(error);
      }
    }
    const timer = setTimeout(() => {
      fail(
        new Error(
          `The simulator did not answer "${request.action}" within ${Math.round(timeoutMs / 1000)} seconds. Check that the session still runs with \`eas simulator:get\`, then try again.`
        )
      );
    }, timeoutMs);

    ws.on('message', data => {
      let parsed: z.infer<typeof SocketMessage>;
      try {
        parsed = SocketMessage.parse(JSON.parse(data.toString()));
      } catch {
        return;
      }
      if ('ready' in parsed) {
        ws.send(
          JSON.stringify({ id: 1, action: request.action, params: { ...request.params, udid } })
        );
      } else if ('error' in parsed) {
        fail(
          parsed.error.startsWith('unknown action')
            ? new Error(
                `This simulator session runs a serve-sim version that does not support "${request.action}". Start a new session with \`eas simulator:start\` to get a newer version.`
              )
            : new Error(`The simulator refused "${request.action}": ${parsed.error}`)
        );
      } else if (settle()) {
        resolve({ stdout: parsed.stdout, stderr: parsed.stderr, exitCode: parsed.exitCode });
      }
    });
    ws.on('unexpected-response', (_req, res) => {
      fail(
        new Error(
          `The simulator preview server refused the connection (HTTP ${res.statusCode}). The session token can be out of date. Run \`eas simulator:get\` to check the session, then try again.`
        )
      );
    });
    ws.on('error', error => {
      fail(
        new Error(
          `Could not connect to the simulator preview server: ${error.message}. Check your network connection and that the session still runs.`
        )
      );
    });
    ws.on('close', () => {
      fail(
        new Error(
          `The simulator preview server closed the connection before it answered "${request.action}". Try again.`
        )
      );
    });
  });
}
