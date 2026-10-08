import { createServer } from 'node:http';
import { type AddressInfo } from 'node:net';
import { PassThrough, Readable } from 'node:stream';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import fetch, { Headers, RequestError, Response } from '../../fetch';
import { DeviceRunSessionByIdQuery, DeviceRunSessionStatus } from '../../graphql/generated';
import { DeviceRunSessionQuery } from '../../graphql/queries/DeviceRunSessionQuery';
import {
  fetchSimulatorPreviewAsync,
  fetchSimulatorPreviewJsonAsync,
  resolveSimulatorPreviewAsync,
  streamSimulatorPreviewAsync,
} from '../preview';

jest.mock('../../graphql/queries/DeviceRunSessionQuery');
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

function rejectWithStatus(status: number): void {
  jest
    .mocked(fetch)
    .mockRejectedValue(
      new RequestError('not found', new Response(Readable.from(['']), { status }))
    );
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe(resolveSimulatorPreviewAsync, () => {
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
      const resolved = await resolveSimulatorPreviewAsync(graphqlClient, 'session-id');
      expect(DeviceRunSessionQuery.byIdAsync).toHaveBeenCalledWith(graphqlClient, 'session-id');
      expect(resolved.token).toBe('preview-token');
      expect(resolved.baseUrl.toString()).toBe('https://preview.test/prefix/?device=SIM-A');
    }
  );

  it.each([
    [DeviceRunSessionStatus.Stopped, { previewApiUrl: 'https://preview.test' }, 'is not running'],
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
      { __typename: 'ArgentRunSessionRemoteConfig', previewApiUrl: 'https://preview.test' },
      'does not include a preview API token',
    ],
    [
      DeviceRunSessionStatus.InProgress,
      {
        __typename: 'ArgentRunSessionRemoteConfig',
        previewApiUrl: 'https://preview.test/?token=embedded',
      },
      'does not include a preview API token',
    ],
  ])('rejects unavailable or invalid preview configuration %#', async (status, config, message) => {
    jest.mocked(DeviceRunSessionQuery.byIdAsync).mockResolvedValue(session(config, status));
    await expect(resolveSimulatorPreviewAsync(graphqlClient, 'id')).rejects.toThrow(message);
  });
});

describe(fetchSimulatorPreviewAsync, () => {
  it('preserves the mounted route and device while using header authentication', async () => {
    jest.mocked(fetch).mockResolvedValue(new Response('{}'));
    await fetchSimulatorPreviewAsync(preview, '/logs', { query: { snapshot: '1' } });
    expect(fetch).toHaveBeenCalledWith(
      'https://preview.test/prefix/logs?device=SIM-A&snapshot=1',
      expect.anything()
    );
    const headers = new Headers(jest.mocked(fetch).mock.calls[0][1]?.headers);
    expect(headers.get('authorization')).toBe('Bearer secret-token');
  });

  it('reports an offline preview tunnel before interpreting the route failure', async () => {
    jest.mocked(fetch).mockRejectedValue(
      new RequestError(
        'https://preview.test/?token=secret-token',
        new Response(Readable.from(['secret response']), {
          status: 404,
          headers: { 'ngrok-error-code': 'ERR_NGROK_3200' },
        })
      )
    );
    await expect(
      fetchSimulatorPreviewAsync(preview, '/logs', { notFoundMessage: 'Not found here.' })
    ).rejects.toThrow(
      'The simulator preview is offline. The session may have stopped or reached its time limit. Start a new session with `eas simulator:start`.'
    );
  });

  it.each([
    [401, 'refused access'],
    [403, 'refused access'],
    [404, 'does not support this request'],
    [500, 'HTTP 500'],
  ])('reports HTTP %s without exposing response bodies or credentials', async (status, message) => {
    jest
      .mocked(fetch)
      .mockRejectedValue(
        new RequestError(
          'https://preview.test/?token=secret-token',
          new Response(Readable.from(['secret response']), { status })
        )
      );
    const error = fetchSimulatorPreviewAsync(preview, '/logs');
    await expect(error).rejects.toThrow(message);
    await expect(error).rejects.not.toThrow('secret');
  });

  it('uses the caller message for a missing route', async () => {
    rejectWithStatus(404);
    await expect(
      fetchSimulatorPreviewAsync(preview, '/crashes/old-id', {
        notFoundMessage: 'The crash report was not found.',
      })
    ).rejects.toThrow('The crash report was not found.');
  });

  it('does not expose URLs in connection errors', async () => {
    jest.mocked(fetch).mockRejectedValueOnce(new Error('https://preview.test/?token=secret-token'));
    await expect(fetchSimulatorPreviewAsync(preview, '/logs')).rejects.toThrow(
      'Could not connect to the simulator preview API.'
    );
  });
});

describe(fetchSimulatorPreviewJsonAsync, () => {
  it('requests JSON and returns the parsed response', async () => {
    jest.mocked(fetch).mockResolvedValue(new Response('{"lines":[]}'));
    await expect(
      fetchSimulatorPreviewJsonAsync(preview, '/logs', { query: { snapshot: '1' } })
    ).resolves.toEqual({ lines: [] });
    expect(fetch).toHaveBeenCalledWith(
      'https://preview.test/prefix/logs?device=SIM-A&snapshot=1',
      expect.anything()
    );
    const headers = new Headers(jest.mocked(fetch).mock.calls[0][1]?.headers);
    expect(headers.get('accept')).toBe('application/json');
  });

  it('passes the caller message for a missing route', async () => {
    rejectWithStatus(404);
    await expect(
      fetchSimulatorPreviewJsonAsync(preview, '/crashes/old-id', {
        notFoundMessage: 'The crash report was not found.',
      })
    ).rejects.toThrow('The crash report was not found.');
  });

  it('does not expose response data in invalid JSON errors', async () => {
    jest.mocked(fetch).mockResolvedValueOnce(new Response('secret-token invalid json'));
    const error = fetchSimulatorPreviewJsonAsync(preview, '/logs');
    await expect(error).rejects.toThrow('Could not read the simulator preview API response.');
    await expect(error).rejects.not.toThrow('secret-token');
  });
});

describe(streamSimulatorPreviewAsync, () => {
  const signal = new AbortController().signal;

  function getRequestSignal(): AbortSignal | undefined {
    return jest.mocked(fetch).mock.calls[0][1]?.signal ?? undefined;
  }

  it('parses SSE across chunk boundaries and closes the connection', async () => {
    const body = Readable.from([
      ': heartbeat\r\ndata: fir',
      'st\r\ndata: second\r\n\r\ndata: last\n\n',
    ]);
    jest
      .mocked(fetch)
      .mockResolvedValue(new Response(body, { headers: { 'content-type': 'text/event-stream' } }));
    const onData = jest.fn();
    await streamSimulatorPreviewAsync(preview, '/logs', onData, { signal });
    expect(onData.mock.calls).toEqual([['first\nsecond'], ['last']]);
    expect(getRequestSignal()?.aborted).toBe(true);
    const headers = new Headers(jest.mocked(fetch).mock.calls[0][1]?.headers);
    expect(headers.get('accept')).toBe('text/event-stream');
  });

  it('preserves setup errors when a follow request is refused', async () => {
    rejectWithStatus(403);
    await expect(
      streamSimulatorPreviewAsync(preview, '/logs', jest.fn(), { signal })
    ).rejects.toThrow('refused access');
  });

  it('stops when the signal aborts and releases the response', async () => {
    const body = new PassThrough();
    jest.mocked(fetch).mockImplementationOnce(async (_url, init) => {
      init?.signal?.addEventListener('abort', () => body.destroy(new Error('aborted')));
      return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
    });
    const abortController = new AbortController();
    const onData = jest.fn(() => {
      abortController.abort();
    });
    const following = streamSimulatorPreviewAsync(preview, '/logs', onData, {
      signal: abortController.signal,
    });
    body.write('data: marker\n\n');
    await following;
    expect(onData).toHaveBeenCalledWith('marker');
    expect(body.destroyed).toBe(true);
  });

  it('stops when the signal aborts while waiting for response headers', async () => {
    const abortController = new AbortController();
    jest.mocked(fetch).mockImplementationOnce(
      async (_url, init) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new Error('aborted'));
          });
          process.nextTick(() => {
            abortController.abort();
          });
        })
    );
    const onData = jest.fn();
    await streamSimulatorPreviewAsync(preview, '/logs', onData, {
      signal: abortController.signal,
    });
    expect(onData).not.toHaveBeenCalled();
  });

  it('reports a stream that fails while reading without echoing its data', async () => {
    const body = new PassThrough();
    jest
      .mocked(fetch)
      .mockResolvedValueOnce(
        new Response(body, { headers: { 'content-type': 'text/event-stream' } })
      );
    const following = streamSimulatorPreviewAsync(preview, '/logs', jest.fn(), { signal });
    body.destroy(new Error('secret-token'));
    await expect(following).rejects.toThrow('The simulator preview stream ended unexpectedly.');
    await expect(following).rejects.not.toThrow('secret-token');
  });

  it('rethrows handler errors unchanged and closes the connection', async () => {
    jest.mocked(fetch).mockResolvedValueOnce(
      new Response(Readable.from(['data: frame\n\n']), {
        headers: { 'content-type': 'text/event-stream' },
      })
    );
    await expect(
      streamSimulatorPreviewAsync(
        preview,
        '/logs',
        () => {
          throw new Error('Handler failed.');
        },
        { signal }
      )
    ).rejects.toThrow('Handler failed.');
    expect(getRequestSignal()?.aborted).toBe(true);
  });

  it('reports a stream that goes silent after an event once the idle timeout passes', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write(':\n\ndata: marker\n\n');
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
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    try {
      let received: () => void = () => {};
      const receivedMarker = new Promise<void>(resolve => {
        received = resolve;
      });
      const following = streamSimulatorPreviewAsync(remote, '/logs', received, { signal });
      await receivedMarker;
      jest.advanceTimersByTime(60_000);
      await expect(following).rejects.toThrow('The simulator preview stream ended unexpectedly.');
    } finally {
      jest.useRealTimers();
      server.closeAllConnections();
      await new Promise<void>(resolve =>
        server.close(() => {
          resolve();
        })
      );
    }
  });

  it('closes the upstream connection after rejecting a response that is not an event stream', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' });
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
    let timeout: NodeJS.Timeout | undefined;
    try {
      await expect(
        streamSimulatorPreviewAsync(remote, '/logs', jest.fn(), { signal })
      ).rejects.toThrow('does not support streaming');
      await Promise.race([
        closed,
        new Promise<void>((_resolve, reject) => {
          timeout = setTimeout(() => {
            reject(new Error('The upstream connection stayed open.'));
          }, 1000);
        }),
      ]);
    } finally {
      clearTimeout(timeout);
      server.closeAllConnections();
      await new Promise<void>(resolve =>
        server.close(() => {
          resolve();
        })
      );
    }
  });
});
