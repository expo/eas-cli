import { PassThrough, Readable } from 'node:stream';
import { createServer } from 'node:http';
import { type AddressInfo } from 'node:net';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import fetch, { Headers, RequestError, Response } from '../../fetch';
import { DeviceRunSessionByIdQuery, DeviceRunSessionStatus } from '../../graphql/generated';
import { DeviceRunSessionQuery } from '../../graphql/queries/DeviceRunSessionQuery';
import { loadSimulatorEnvAsync } from '../env';
import {
  fetchSimulatorPreviewAsync,
  fetchSimulatorPreviewJsonAsync,
  resolveSimulatorPreviewAsync,
  sanitizeSimulatorText,
  streamSimulatorPreviewAsync,
} from '../preview';

jest.mock('../../graphql/queries/DeviceRunSessionQuery');
jest.mock('../env', () => ({ ...jest.requireActual('../env'), loadSimulatorEnvAsync: jest.fn() }));
jest.mock('../../fetch', () => ({
  __esModule: true,
  ...jest.requireActual('../../fetch'),
  default: jest.fn(),
}));

const graphqlClient = {} as ExpoGraphqlClient;
const preview = {
  deviceRunSessionId: 'session-id',
  baseUrl: new URL('https://preview.test/prefix/?device=SIM-A'),
  token: 'secret-token',
};

function session(
  remoteConfig: unknown,
  status = DeviceRunSessionStatus.InProgress
): DeviceRunSessionByIdQuery['deviceRunSessions']['byId'] {
  return {
    id: 'session-id',
    status,
    remoteConfig,
  } as DeviceRunSessionByIdQuery['deviceRunSessions']['byId'];
}

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.EAS_SIMULATOR_SESSION_ID;
});

afterEach(() => {
  delete process.env.EAS_SIMULATOR_SESSION_ID;
});

it.each([
  ['ArgentRunSessionRemoteConfig', 'webPreviewToken'],
  ['AgentDeviceRunSessionRemoteConfig', 'webPreviewToken'],
  ['AppiumRunSessionRemoteConfig', 'webPreviewToken'],
  ['ServeSimRunSessionRemoteConfig', 'previewToken'],
  ['WebPreviewOnlyRunSessionRemoteConfig', 'previewToken'],
])(
  'resolves preview authentication for %s without using controller credentials',
  async (__typename, tokenKey) => {
    jest.mocked(DeviceRunSessionQuery.byIdAsync).mockResolvedValue(
      session({
        __typename,
        previewApiUrl: 'https://preview.test/prefix/?device=SIM-A&token=old-token#fragment',
        [tokenKey]: 'preview-token',
        toolsAuthToken: 'wrong-controller-token',
        agentDeviceRemoteSessionToken: 'wrong-controller-token',
      })
    );
    const resolved = await resolveSimulatorPreviewAsync(graphqlClient, '/project', 'explicit-id');
    expect(loadSimulatorEnvAsync).toHaveBeenCalledWith('/project');
    expect(DeviceRunSessionQuery.byIdAsync).toHaveBeenCalledWith(graphqlClient, 'explicit-id');
    expect(resolved.token).toBe('preview-token');
    expect(resolved.baseUrl.toString()).toBe('https://preview.test/prefix/?device=SIM-A');
  }
);

it('uses the dotenv session ID and accepts a token embedded in the preview API URL', async () => {
  process.env.EAS_SIMULATOR_SESSION_ID = 'dotenv-id';
  jest.mocked(DeviceRunSessionQuery.byIdAsync).mockResolvedValue(
    session({
      __typename: 'ArgentRunSessionRemoteConfig',
      previewApiUrl: 'https://preview.test/?token=embedded',
    })
  );
  expect((await resolveSimulatorPreviewAsync(graphqlClient, '/project')).token).toBe('embedded');
  expect(DeviceRunSessionQuery.byIdAsync).toHaveBeenCalledWith(graphqlClient, 'dotenv-id');
});

it('rejects a missing session before querying', async () => {
  await expect(resolveSimulatorPreviewAsync(graphqlClient, '/project')).rejects.toThrow(
    'No simulator session ID'
  );
  expect(DeviceRunSessionQuery.byIdAsync).not.toHaveBeenCalled();
});

it.each([
  [DeviceRunSessionStatus.Stopped, { previewApiUrl: 'https://preview.test' }, 'must be running'],
  [
    DeviceRunSessionStatus.InProgress,
    { webPreviewUrl: 'https://expo.dev/preview' },
    'does not expose a preview API',
  ],
  [DeviceRunSessionStatus.InProgress, { previewApiUrl: 'not a URL' }, 'invalid preview API URL'],
  [
    DeviceRunSessionStatus.InProgress,
    { previewApiUrl: 'file:///private/secret' },
    'invalid preview API URL',
  ],
  [
    DeviceRunSessionStatus.InProgress,
    { previewApiUrl: 'https://preview.test' },
    'does not include a preview API token',
  ],
])('rejects unavailable or invalid preview configuration %#', async (status, config, message) => {
  jest.mocked(DeviceRunSessionQuery.byIdAsync).mockResolvedValue(session(config, status));
  await expect(resolveSimulatorPreviewAsync(graphqlClient, '/project', 'id')).rejects.toThrow(
    message
  );
});

it('preserves the mounted route and device while using header authentication', async () => {
  jest.mocked(fetch).mockResolvedValue(new Response(Readable.from([Buffer.from('{"lines":[]}')])));
  await fetchSimulatorPreviewJsonAsync(preview, '/logs', { snapshot: '1' });
  expect(fetch).toHaveBeenCalledWith(
    'https://preview.test/prefix/logs?device=SIM-A&snapshot=1',
    expect.objectContaining({
      redirect: 'error',
    })
  );
  const headers = new Headers(jest.mocked(fetch).mock.calls[0][1]?.headers);
  expect(headers.get('authorization')).toBe('Bearer secret-token');
  expect(headers.get('accept')).toBe('application/json');
});

it.each([
  { Accept: 'application/json', Authorization: 'wrong-token' },
  new Headers({ Accept: 'application/json', Authorization: 'wrong-token' }),
  [
    ['Accept', 'application/json'],
    ['Authorization', 'wrong-token'],
  ],
])('preserves headers while using the resolved preview credential %#', async headers => {
  jest.mocked(fetch).mockResolvedValue(new Response('{}'));
  await fetchSimulatorPreviewAsync(preview, '/logs', undefined, { headers });
  const sent = new Headers(jest.mocked(fetch).mock.calls[0][1]?.headers);
  expect(sent.get('accept')).toBe('application/json');
  expect(sent.get('authorization')).toBe('Bearer secret-token');
});

it('reports an offline preview tunnel before interpreting the route failure', async () => {
  const body = Readable.from(['secret response']);
  jest.mocked(fetch).mockRejectedValue(
    new RequestError(
      'https://preview.test/?token=secret-token',
      new Response(body, {
        status: 404,
        headers: { 'ngrok-error-code': 'ERR_NGROK_3200' },
      })
    )
  );
  await expect(fetchSimulatorPreviewJsonAsync(preview, '/logs')).rejects.toThrow(
    'The simulator preview is offline. The session may have ended or timed out. Start a new session with `eas simulator:start`.'
  );
  expect(body.destroyed).toBe(true);
});

it.each([401, 403, 404, 500])(
  'reports HTTP %s without exposing response bodies or credentials',
  async status => {
    jest
      .mocked(fetch)
      .mockRejectedValue(
        new RequestError(
          'https://preview.test/?token=secret-token',
          new Response(Readable.from(['secret response']), { status })
        )
      );
    await expect(fetchSimulatorPreviewJsonAsync(preview, '/logs')).rejects.toThrow(
      status === 401 || status === 403
        ? 'access was refused'
        : status === 404
          ? 'not found or is not supported'
          : 'HTTP 500'
    );
  }
);

it('does not expose URLs in connection or invalid JSON errors', async () => {
  jest.mocked(fetch).mockRejectedValueOnce(new Error('https://preview.test/?token=secret-token'));
  await expect(fetchSimulatorPreviewJsonAsync(preview, '/logs')).rejects.toThrow(
    'Could not connect'
  );
  jest
    .mocked(fetch)
    .mockResolvedValueOnce(new Response(Readable.from(['secret-token invalid json'])));
  await expect(fetchSimulatorPreviewJsonAsync(preview, '/logs')).rejects.toThrow(
    'Could not read the simulator preview API response.'
  );
});

it('parses SSE across chunk boundaries and closes the response and interrupt listener', async () => {
  const body = Readable.from([
    ': heartbeat\r\ndata: fir',
    'st\r\ndata: second\r\n\r\ndata: last\n\n',
  ]);
  jest
    .mocked(fetch)
    .mockResolvedValue(new Response(body, { headers: { 'content-type': 'text/event-stream' } }));
  const listeners = process.listeners('SIGINT');
  const onData = jest.fn();
  await streamSimulatorPreviewAsync(preview, '/logs', onData);
  expect(onData.mock.calls).toEqual([['first\nsecond'], ['last']]);
  expect(body.destroyed).toBe(true);
  expect(process.listeners('SIGINT')).toEqual(listeners);
});

it('preserves setup errors when a follow request is refused', async () => {
  jest
    .mocked(fetch)
    .mockRejectedValue(
      new RequestError('secret-token', new Response(Readable.from(['']), { status: 403 }))
    );
  await expect(streamSimulatorPreviewAsync(preview, '/logs', jest.fn())).rejects.toThrow(
    'access was refused'
  );
});

it('stops following on SIGINT and releases the response and listener', async () => {
  const body = new PassThrough();
  jest.mocked(fetch).mockImplementationOnce(async (_url, init) => {
    init?.signal?.addEventListener('abort', () => body.destroy(new Error('aborted')));
    return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
  });
  const listeners = process.listeners('SIGINT');
  const onData = jest.fn(() => process.emit('SIGINT'));
  const following = streamSimulatorPreviewAsync(preview, '/logs', onData);
  body.write('data: marker\n\n');
  await following;
  expect(onData).toHaveBeenCalledWith('marker');
  expect(body.destroyed).toBe(true);
  expect(process.listeners('SIGINT')).toEqual(listeners);
});

it('handles SIGINT while waiting for response headers', async () => {
  jest.mocked(fetch).mockImplementationOnce(
    async (_url, init) =>
      await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new Error('aborted'));
        });
        process.nextTick(() => process.emit('SIGINT'));
      })
  );
  const listeners = process.listeners('SIGINT');
  const onData = jest.fn();
  await streamSimulatorPreviewAsync(preview, '/logs', onData);
  expect(onData).not.toHaveBeenCalled();
  expect(process.listeners('SIGINT')).toEqual(listeners);
});

it.each([
  { json: false, status: 200, message: 'does not support streaming preview data' },
  { json: true, status: 401, message: 'access was refused' },
])(
  'closes the upstream connection after rejecting response %#',
  async ({ json, status, message }) => {
    const server = createServer((_request, response) => {
      response.writeHead(status, { 'content-type': 'text/plain' });
      response.write('body that never ends');
    });
    const closed = new Promise<void>(resolve => {
      server.once('connection', socket => socket.once('close', resolve));
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const remote = {
      ...preview,
      baseUrl: new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}`),
    };
    jest
      .mocked(fetch)
      .mockImplementationOnce(
        jest.requireActual<typeof import('../../fetch')>('../../fetch').default
      );
    const listeners = process.listeners('SIGINT');
    let timeout: NodeJS.Timeout | undefined;
    try {
      await expect(
        json
          ? fetchSimulatorPreviewJsonAsync(remote, '/logs')
          : streamSimulatorPreviewAsync(remote, '/logs', jest.fn())
      ).rejects.toThrow(message);
      await Promise.race([
        closed,
        new Promise<void>((_resolve, reject) => {
          timeout = setTimeout(() => {
            reject(new Error('The upstream connection stayed open.'));
          }, 1000);
        }),
      ]);
      expect(process.listeners('SIGINT')).toEqual(listeners);
    } finally {
      clearTimeout(timeout);
      server.closeAllConnections();
      await new Promise<void>(resolve =>
        server.close(() => {
          resolve();
        })
      );
    }
  }
);

it('closes the response when handling a stream frame fails without echoing its data', async () => {
  const body = Readable.from(['data: secret-token\n\n']);
  jest
    .mocked(fetch)
    .mockResolvedValueOnce(
      new Response(body, { headers: { 'content-type': 'text/event-stream' } })
    );
  const listeners = process.listeners('SIGINT');
  await expect(
    streamSimulatorPreviewAsync(preview, '/logs', () => {
      throw new Error('secret-token');
    })
  ).rejects.toThrow('The simulator preview stream ended unexpectedly.');
  expect(body.destroyed).toBe(true);
  expect(process.listeners('SIGINT')).toEqual(listeners);
});

it('removes terminal controls from human output while retaining newlines', () => {
  expect(sanitizeSimulatorText('\u001b[31mhello\u001b[0m\u0007\nworld')).toBe('hello\nworld');
});
