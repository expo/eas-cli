import WebSocket from 'ws';
import { z } from 'zod';

import { PreviewApiAccess } from './utils';
import fetch, { RequestError, httpsProxyAgent } from '../fetch';

export type HostActionRequest = {
  action: string;
  params: Record<string, unknown>;
};

export type HostActionResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

type HostActionSpec = {
  args: string;
  jsonOutput?: boolean;
  toRequest: (values: string[]) => HostActionRequest | null;
};

function toNumberIfNumeric(value: string): number | string {
  return /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : value;
}

function setting(prefix: string): HostActionSpec {
  return {
    args: '[value]',
    toRequest: values => {
      if (values.length === 0) {
        return { action: `${prefix}.get`, params: {} };
      }
      if (values.length === 1) {
        return { action: `${prefix}.set`, params: { value: values[0] } };
      }
      return null;
    },
  };
}

function withoutValues(action: string): HostActionSpec {
  return {
    args: '',
    toRequest: values => (values.length === 0 ? { action, params: {} } : null),
  };
}

const HOST_ACTIONS: Record<string, HostActionSpec> = {
  'hardware-keyboard': setting('hardwareKeyboard'),
  'reduce-motion': setting('reduceMotion'),
  'increase-contrast': setting('increaseContrast'),
  'reduce-transparency': setting('reduceTransparency'),
  voiceover: setting('voiceover'),
  'liquid-glass': setting('liquidGlass'),
  'color-filter': setting('colorFilter'),
  'text-size': setting('textSize'),
  'show-borders': setting('showBorders'),
  settings: { ...withoutValues('settings.status'), jsonOutput: true },
  'software-keyboard': withoutValues('softwareKeyboard.toggle'),
  'memory-warning': withoutValues('memoryWarning'),
  'ca-debug': {
    args: '<blended|copies|misaligned|offscreen|slow-animations> <on|off>',
    toRequest: values =>
      values.length === 2
        ? { action: 'caDebug.set', params: { option: values[0], value: values[1] } }
        : null,
  },
  hinge: {
    args: '<fold|half|unfold|0-180>',
    toRequest: ([value, ...rest]) =>
      value !== undefined && rest.length === 0
        ? {
            action: 'hinge.set',
            params: { value: toNumberIfNumeric(value) },
          }
        : null,
  },
  permissions: {
    args: '[list [bundle-id] | grant|revoke|reset <permission> <bundle-id> | reset all <bundle-id>]',
    jsonOutput: true,
    toRequest: values => {
      const [verb = 'list', ...rest] = values;
      if (verb === 'list' && rest.length <= 1) {
        return { action: 'permissions.list', params: rest[0] ? { bundleId: rest[0] } : {} };
      }
      if (rest.length !== 2) {
        return null;
      }
      const [permission, bundleId] = rest;
      if (verb === 'reset' && permission === 'all') {
        return { action: 'permissions.resetAll', params: { bundleId } };
      }
      return { action: 'permissions.set', params: { action: verb, service: permission, bundleId } };
    },
  },
  appearance: setting('appearance'),
  location: {
    args: '<latitude> <longitude> | clear',
    toRequest: values => {
      if (values.length === 1 && values[0] === 'clear') {
        return { action: 'location.clear', params: {} };
      }
      if (values.length !== 2) {
        return null;
      }
      const [lat, lng] = values.map(toNumberIfNumeric);
      return { action: 'location.set', params: { lat, lng } };
    },
  },
  rotate: {
    args: '<portrait|portrait_upside_down|landscape_left|landscape_right>',
    toRequest: values =>
      values.length === 1 ? { action: 'rotate', params: { value: values[0] } } : null,
  },
  button: {
    args: '<home|swipe_home|app_switcher|lock|siri|side_button>',
    toRequest: values =>
      values.length === 1 ? { action: 'button', params: { value: values[0] } } : null,
  },
};

const HOST_ACTION_TIMEOUT_MS = 130_000;
const PREVIEW_API_TIMEOUT_MS = 30_000;

const PreviewConfig = z.object({ device: z.string().min(1) });

const ReplyToRequest = z.object({ id: z.literal(1) });

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

export function formatHostActionUsage(): string {
  return Object.entries(HOST_ACTIONS)
    .map(([name, spec]) => `${name} ${spec.args}`.trim())
    .join('\n');
}

export function hostActionPrintsJson(name: string): boolean {
  return Object.hasOwn(HOST_ACTIONS, name) && HOST_ACTIONS[name].jsonOutput === true;
}

export function resolveHostActionRequest(name: string, values: string[]): HostActionRequest {
  if (!Object.hasOwn(HOST_ACTIONS, name)) {
    throw new Error(
      `Unknown simulator action "${name}". Use one of: ${Object.keys(HOST_ACTIONS).join(', ')}.`
    );
  }
  const spec = HOST_ACTIONS[name];
  const request = spec.toRequest(values);
  if (!request) {
    throw new Error(
      `Wrong arguments for "${name}". Usage: eas simulator:control ${`${name} ${spec.args}`.trim()}`
    );
  }
  return request;
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
  let text: string;
  try {
    const response = await fetch(previewEndpoint(apiUrl, 'api').toString(), {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(PREVIEW_API_TIMEOUT_MS),
    });
    text = await response.text();
  } catch (error) {
    if (error instanceof RequestError && [401, 403].includes(error.response.status)) {
      throw new Error(
        `The simulator preview server refused the session token (HTTP ${error.response.status}). Run \`eas simulator:get\` to check that the session still runs, then try again.`
      );
    }
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(
        `The simulator preview server did not answer within ${PREVIEW_API_TIMEOUT_MS / 1000} seconds. Run \`eas simulator:get\` to check that the session still runs, then try again.`
      );
    }
    throw error;
  }
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {}
  const config = PreviewConfig.safeParse(body);
  if (!config.success) {
    throw new Error(
      'The simulator preview server did not report which simulator it streams. The session may still be starting. Wait a few seconds and run the command again.'
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
          `The simulator did not answer within ${Math.round(timeoutMs / 1000)} seconds. The action may still have run. Check the session with \`eas simulator:get\` and the current state before you try again.`
        )
      );
    }, timeoutMs);

    ws.on('message', data => {
      let message: unknown;
      try {
        message = JSON.parse(data.toString());
      } catch {
        return;
      }
      const parsed = SocketMessage.safeParse(message);
      if (!parsed.success) {
        if (ReplyToRequest.safeParse(message).success) {
          fail(
            new Error(
              'The simulator preview server sent a reply that this version of eas-cli cannot read. Update eas-cli and try again.'
            )
          );
        }
        return;
      }
      const reply = parsed.data;
      if ('ready' in reply) {
        ws.send(
          JSON.stringify({ id: 1, action: request.action, params: { ...request.params, udid } })
        );
      } else if ('error' in reply) {
        fail(
          reply.error.startsWith('unknown action')
            ? new Error(
                'This simulator session runs a serve-sim version that does not support this action. Start a new session with `eas simulator:start` to get a newer version.'
              )
            : new Error(`The simulator refused the request: ${reply.error}`)
        );
      } else if (settle()) {
        resolve({ stdout: reply.stdout, stderr: reply.stderr, exitCode: reply.exitCode });
      }
    });
    ws.on('unexpected-response', (_req, res) => {
      fail(
        new Error(
          `The simulator preview server refused the connection (HTTP ${res.statusCode}). The session token may be out of date. Run \`eas simulator:get\` to check the session, then try again.`
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
          'The simulator preview server closed the connection before it answered. The action may still have run. Check the current state before you try again.'
        )
      );
    });
  });
}
