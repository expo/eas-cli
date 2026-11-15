import { type bunyan } from '@expo/logger';
import * as ngrok from '@ngrok/ngrok';
import { once } from 'node:events';
import { createServer } from 'node:http';
import WebSocket, { WebSocketServer } from 'ws';
import { type AddressInfo, createConnection, createServer as createTcpServer } from 'node:net';

import { turtleFetch } from '../../../utils/turtleFetch';
import { startNgrokTunnelAsync } from '../ngrokTunnel';

jest.mock('@ngrok/ngrok');
jest.mock('node:timers', () => ({
  setTimeout: (...args: Parameters<typeof setTimeout>) => setTimeout(...args),
  clearTimeout: (...args: Parameters<typeof clearTimeout>) => clearTimeout(...args),
}));
jest.mock('../../../utils/turtleFetch');

const { Response } = jest.requireActual<typeof import('node-fetch')>('node-fetch');
const url = 'https://web-preview-fixed.example.test';
const logger = { info: jest.fn(), warn: jest.fn() } as unknown as bunyan;
const options = {
  port: 4321,
  subdomainPrefix: 'web-preview',
  subdomainId: 'fixed',
  baseDomain: 'example.test',
  authtoken: 'token',
  rewriteHostHeader: true,
  healthCheck: { path: '/healthz' },
  logger,
};

function listener(publicUrl = url) {
  return { url: () => publicUrl, close: jest.fn().mockResolvedValue(undefined) };
}

let initial: ReturnType<typeof listener>;
let replacement: ReturnType<typeof listener>;

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
  jest.clearAllMocks();
  initial = listener();
  replacement = listener();
  jest
    .mocked(ngrok.forward)
    .mockReset()
    .mockResolvedValueOnce(initial as never)
    .mockResolvedValue(replacement as never);
  jest
    .mocked(turtleFetch)
    .mockReset()
    .mockResolvedValue(new Response(undefined, { status: 200 }));
});

afterEach(() => {
  jest.useRealTimers();
});

function failPublicProbes() {
  jest.mocked(turtleFetch).mockImplementation(
    async target =>
      new Response(undefined, {
        status: target.startsWith('https:') ? 503 : 200,
      })
  );
}

it('keeps tunnels without a health check unsupervised and closes them on stop', async () => {
  const tunnel = await startNgrokTunnelAsync({ ...options, healthCheck: undefined });
  await jest.advanceTimersByTimeAsync(90_000);
  expect(turtleFetch).not.toHaveBeenCalled();
  expect(ngrok.forward).toHaveBeenCalledTimes(1);
  await tunnel.stopAsync();
  expect(initial.close).toHaveBeenCalledTimes(1);
});

it('probes the public service and keeps a healthy listener open', async () => {
  const tunnel = await startNgrokTunnelAsync(options);
  try {
    await jest.advanceTimersByTimeAsync(45_000);
    expect(turtleFetch).toHaveBeenCalledTimes(3);
    expect(turtleFetch).toHaveBeenCalledWith(
      `${url}/healthz`,
      'GET',
      expect.objectContaining({
        retries: 0,
        redirect: 'manual',
        headers: expect.objectContaining({ 'ngrok-skip-browser-warning': 'true' }),
      })
    );
    expect(ngrok.forward).toHaveBeenCalledTimes(1);
  } finally {
    await tunnel.stopAsync();
  }
  expect(initial.close).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(60_000);
  expect(turtleFetch).toHaveBeenCalledTimes(3);
});

it('reopens after three failed public probes with a healthy local service, preserving the endpoint', async () => {
  failPublicProbes();
  const tunnel = await startNgrokTunnelAsync(options);
  try {
    await jest.advanceTimersByTimeAsync(30_000);
    expect(initial.close).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(15_000);
    expect(initial.close).toHaveBeenCalledTimes(1);
    expect(ngrok.forward).toHaveBeenCalledTimes(2);
    expect(jest.mocked(ngrok.forward).mock.calls[1][0]).toEqual({
      addr: expect.any(Number),
      authtoken: 'token',
      domain: 'web-preview-fixed.example.test',
      request_header_add: ['Host:localhost:4321'],
      force_new_session: true,
    });
    expect(tunnel.url).toBe(url);
    jest.mocked(turtleFetch).mockResolvedValue(new Response(undefined, { status: 200 }));
    await jest.advanceTimersByTimeAsync(15_000);
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('healthy again'));
  } finally {
    await tunnel.stopAsync();
  }
  expect(replacement.close).toHaveBeenCalledTimes(1);
});

it('does not reopen when the local service is unhealthy', async () => {
  jest.mocked(turtleFetch).mockResolvedValue(new Response(undefined, { status: 503 }));
  const tunnel = await startNgrokTunnelAsync(options);
  try {
    await jest.advanceTimersByTimeAsync(90_000);
    expect(ngrok.forward).toHaveBeenCalledTimes(1);
    expect(initial.close).not.toHaveBeenCalled();
  } finally {
    await tunnel.stopAsync();
  }
});

it('resets consecutive failures after a successful public probe', async () => {
  failPublicProbes();
  const tunnel = await startNgrokTunnelAsync(options);
  try {
    await jest.advanceTimersByTimeAsync(30_000);
    jest.mocked(turtleFetch).mockResolvedValueOnce(new Response(undefined, { status: 200 }));
    await jest.advanceTimersByTimeAsync(15_000);
    await jest.advanceTimersByTimeAsync(30_000);
    expect(ngrok.forward).toHaveBeenCalledTimes(1);
  } finally {
    await tunnel.stopAsync();
  }
});

it('retries a failed reopen with backoff', async () => {
  failPublicProbes();
  jest
    .mocked(ngrok.forward)
    .mockReset()
    .mockResolvedValueOnce(initial as never)
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue(replacement as never);
  const tunnel = await startNgrokTunnelAsync(options);
  try {
    await jest.advanceTimersByTimeAsync(45_000);
    expect(ngrok.forward).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(1_999);
    expect(ngrok.forward).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(1);
    expect(ngrok.forward).toHaveBeenCalledTimes(3);
  } finally {
    await tunnel.stopAsync();
  }
});

it('closes a listener that finishes opening after shutdown, with idempotent cleanup', async () => {
  failPublicProbes();
  let resolveOpening!: (value: ngrok.Listener) => void;
  jest
    .mocked(ngrok.forward)
    .mockReset()
    .mockResolvedValueOnce(initial as never)
    .mockReturnValueOnce(
      new Promise(resolve => {
        resolveOpening = resolve;
      })
    );
  const tunnel = await startNgrokTunnelAsync(options);
  await jest.advanceTimersByTimeAsync(45_000);
  const stopping = tunnel.stopAsync();
  expect(tunnel.stopAsync()).toBe(stopping);
  const stopped = jest.fn();
  void stopping.then(stopped);
  await jest.advanceTimersByTimeAsync(0);
  expect(stopped).not.toHaveBeenCalled();
  resolveOpening(replacement as never);
  await stopping;
  expect(replacement.close).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(120_000);
  expect(ngrok.forward).toHaveBeenCalledTimes(2);
});

it('waits for a replacement acquired during shutdown to finish closing', async () => {
  failPublicProbes();
  let resolveOpening!: (value: ngrok.Listener) => void;
  let resolveClose!: () => void;
  jest
    .mocked(ngrok.forward)
    .mockReset()
    .mockResolvedValueOnce(initial as never)
    .mockReturnValueOnce(new Promise(resolve => (resolveOpening = resolve)));
  replacement.close.mockReturnValue(new Promise<void>(resolve => (resolveClose = resolve)));
  const tunnel = await startNgrokTunnelAsync(options);
  await jest.advanceTimersByTimeAsync(45_000);
  let stopped = false;
  const stopping = tunnel.stopAsync().then(() => {
    stopped = true;
  });
  await jest.advanceTimersByTimeAsync(0);
  resolveOpening(replacement as never);
  await jest.advanceTimersByTimeAsync(0);
  const stoppedBeforeClose = stopped;
  resolveClose();
  await jest.advanceTimersByTimeAsync(250);
  await stopping;
  expect(stoppedBeforeClose).toBe(false);
  expect(replacement.close).toHaveBeenCalledTimes(1);
});

it.each([0, 4, 5, 10])('retires a reopen cancelled after %s promise turns', async turns => {
  failPublicProbes();
  let resolveOpening!: (value: ngrok.Listener) => void;
  jest
    .mocked(ngrok.forward)
    .mockReset()
    .mockResolvedValueOnce(initial as never)
    .mockReturnValueOnce(new Promise(resolve => (resolveOpening = resolve)));
  const tunnel = await startNgrokTunnelAsync(options);
  await jest.advanceTimersByTimeAsync(45_000);
  resolveOpening(replacement as never);
  for (let turn = 0; turn < turns; turn++) {
    await Promise.resolve();
  }
  await tunnel.stopAsync();
  await jest.advanceTimersByTimeAsync(0);
  expect(replacement.close).toHaveBeenCalledTimes(1);
});

it('retries a rejected close when a reopen finishes after shutdown', async () => {
  failPublicProbes();
  let resolveOpening!: (value: ngrok.Listener) => void;
  jest
    .mocked(ngrok.forward)
    .mockReset()
    .mockResolvedValueOnce(initial as never)
    .mockReturnValueOnce(new Promise(resolve => (resolveOpening = resolve)));
  const tunnel = await startNgrokTunnelAsync(options);
  await jest.advanceTimersByTimeAsync(45_000);
  const stopping = tunnel.stopAsync();
  replacement.close.mockRejectedValueOnce(new Error('temporary unlisten failure'));
  resolveOpening(replacement as never);
  await jest.advanceTimersByTimeAsync(250);
  await stopping;
  expect(replacement.close).toHaveBeenCalledTimes(2);
  const warnings = jest.mocked(logger.warn).mock.calls.length;
  await jest.advanceTimersByTimeAsync(120_000);
  expect(logger.warn).toHaveBeenCalledTimes(warnings);
});

it('fails stop if an in-flight reopen still has not settled by the stop deadline', async () => {
  failPublicProbes();
  let resolveOpening!: (value: ngrok.Listener) => void;
  jest
    .mocked(ngrok.forward)
    .mockReset()
    .mockResolvedValueOnce(initial as never)
    .mockReturnValueOnce(new Promise(resolve => (resolveOpening = resolve)));
  const tunnel = await startNgrokTunnelAsync(options);
  await jest.advanceTimersByTimeAsync(45_000);
  const rejected = expect(tunnel.stopAsync()).rejects.toThrow(
    'Ngrok tunnel web-preview-fixed.example.test stop timed out after 4000ms'
  );
  await jest.advanceTimersByTimeAsync(4_000);
  await rejected;
  expect(ngrok.forward).toHaveBeenCalledTimes(2);
  resolveOpening(replacement as never);
  await jest.advanceTimersByTimeAsync(0);
  expect(replacement.close).toHaveBeenCalledTimes(1);
});

it('retries an old listener while a reopen outlasts shutdown', async () => {
  failPublicProbes();
  initial.close.mockRejectedValueOnce(new Error('agent disconnected'));
  let resolveOpening!: (value: ngrok.Listener) => void;
  jest
    .mocked(ngrok.forward)
    .mockReset()
    .mockResolvedValueOnce(initial as never)
    .mockReturnValueOnce(new Promise(resolve => (resolveOpening = resolve)));
  const tunnel = await startNgrokTunnelAsync(options);
  await jest.advanceTimersByTimeAsync(45_000);
  expect(initial.close).toHaveBeenCalledTimes(1);
  const rejected = expect(tunnel.stopAsync()).rejects.toThrow(
    'Ngrok tunnel web-preview-fixed.example.test stop timed out after 4000ms'
  );
  await jest.advanceTimersByTimeAsync(4_000);
  await rejected;
  const oldCloseCalls = initial.close.mock.calls.length;
  resolveOpening(replacement as never);
  await jest.advanceTimersByTimeAsync(0);
  expect(oldCloseCalls).toBe(2);
  expect(replacement.close).toHaveBeenCalledTimes(1);
  expect(ngrok.forward).toHaveBeenCalledTimes(2);
});

it('fails stop if a pending reopen arrives but cannot be retired', async () => {
  failPublicProbes();
  let resolveOpening!: (value: ngrok.Listener) => void;
  jest
    .mocked(ngrok.forward)
    .mockReset()
    .mockResolvedValueOnce(initial as never)
    .mockReturnValueOnce(new Promise(resolve => (resolveOpening = resolve)));
  replacement.close.mockRejectedValue(new Error('unlisten failed'));
  const tunnel = await startNgrokTunnelAsync(options);
  await jest.advanceTimersByTimeAsync(45_000);
  const rejected = expect(tunnel.stopAsync()).rejects.toThrow(
    'Ngrok tunnel web-preview-fixed.example.test stop timed out'
  );
  resolveOpening(replacement as never);
  await jest.advanceTimersByTimeAsync(4_000);
  await rejected;
  expect(replacement.close.mock.calls.length).toBeGreaterThan(1);
  expect(logger.warn).toHaveBeenCalledWith(
    expect.objectContaining({ err: expect.any(Error) }),
    'Could not retire late ngrok tunnel web-preview-fixed.example.test.'
  );
  const warnings = jest.mocked(logger.warn).mock.calls.length;
  await jest.advanceTimersByTimeAsync(120_000);
  expect(logger.warn).toHaveBeenCalledTimes(warnings);
  expect(ngrok.forward).toHaveBeenCalledTimes(2);
});

it('rejects a changed public URL and closes the replacement', async () => {
  failPublicProbes();
  const changed = listener('https://different.example.test');
  jest
    .mocked(ngrok.forward)
    .mockReset()
    .mockResolvedValueOnce(initial as never)
    .mockResolvedValue(changed as never);
  const tunnel = await startNgrokTunnelAsync(options);
  try {
    await jest.advanceTimersByTimeAsync(45_000);
    expect(changed.close).toHaveBeenCalledTimes(1);
    expect(tunnel.url).toBe(url);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      expect.stringContaining('Could not reopen')
    );
  } finally {
    await tunnel.stopAsync();
  }
});

it('treats ngrok error responses as failures even if their status is accepted', async () => {
  jest.mocked(turtleFetch).mockImplementation(
    async target =>
      new Response(undefined, {
        status: 200,
        headers: target.startsWith('https:') ? { 'ngrok-error-code': 'ERR_NGROK_3200' } : {},
      })
  );
  const tunnel = await startNgrokTunnelAsync(options);
  try {
    await jest.advanceTimersByTimeAsync(45_000);
    expect(ngrok.forward).toHaveBeenCalledTimes(2);
  } finally {
    await tunnel.stopAsync();
  }
});

it('reopens on a fresh agent session even if closing the old listener fails', async () => {
  failPublicProbes();
  initial.close.mockRejectedValueOnce(new Error('agent disconnected'));
  const tunnel = await startNgrokTunnelAsync(options);
  try {
    await jest.advanceTimersByTimeAsync(45_000);
    expect(ngrok.forward).toHaveBeenCalledTimes(2);
    expect(ngrok.forward).toHaveBeenLastCalledWith(
      expect.objectContaining({ force_new_session: true })
    );
    expect(ngrok.disconnect).not.toHaveBeenCalled();
  } finally {
    await tunnel.stopAsync();
  }
  expect(initial.close).toHaveBeenCalledTimes(2);
  expect(replacement.close).toHaveBeenCalledTimes(1);
});

it('retries a rejected close before reopening an endpoint that remains bound', async () => {
  failPublicProbes();
  let domainOccupied = true;
  initial.close
    .mockRejectedValueOnce(new Error('agent disconnected'))
    .mockImplementation(async () => {
      domainOccupied = false;
    });
  jest
    .mocked(ngrok.forward)
    .mockReset()
    .mockResolvedValueOnce(initial as never)
    .mockImplementation(async () => {
      if (domainOccupied) {
        throw new Error('endpoint is still bound');
      }
      return replacement as never;
    });
  const tunnel = await startNgrokTunnelAsync(options);
  try {
    await jest.advanceTimersByTimeAsync(45_000);
    expect(initial.close).toHaveBeenCalledTimes(1);
    expect(ngrok.forward).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(2_000);
    expect(initial.close).toHaveBeenCalledTimes(2);
    expect(ngrok.forward).toHaveBeenCalledTimes(3);
    expect(tunnel.url).toBe(url);
  } finally {
    await tunnel.stopAsync();
  }
  expect(replacement.close).toHaveBeenCalledTimes(1);
});

it('retires an old listener even after its replacement is healthy', async () => {
  failPublicProbes();
  initial.close.mockRejectedValueOnce(new Error('agent disconnected'));
  const tunnel = await startNgrokTunnelAsync(options);
  try {
    await jest.advanceTimersByTimeAsync(45_000);
    expect(initial.close).toHaveBeenCalledTimes(1);
    jest.mocked(turtleFetch).mockResolvedValue(new Response(undefined, { status: 200 }));
    await jest.advanceTimersByTimeAsync(15_000);
    expect(initial.close).toHaveBeenCalledTimes(2);
    expect(ngrok.forward).toHaveBeenCalledTimes(2);
  } finally {
    await tunnel.stopAsync();
  }
});

it('retries an old listener without repeating its close warning on every probe', async () => {
  failPublicProbes();
  initial.close.mockRejectedValue(new Error('old session disconnected'));
  const tunnel = await startNgrokTunnelAsync(options);
  await jest.advanceTimersByTimeAsync(45_000);
  const warnings = jest.mocked(logger.warn).mock.calls.length;
  expect(warnings).toBeGreaterThan(0);
  jest.mocked(turtleFetch).mockResolvedValue(new Response(undefined, { status: 200 }));
  await jest.advanceTimersByTimeAsync(120_000);
  expect(initial.close.mock.calls.length).toBeGreaterThan(1);
  expect(ngrok.forward).toHaveBeenCalledTimes(2);
  expect(logger.warn).toHaveBeenCalledTimes(warnings);
  const rejected = expect(tunnel.stopAsync()).rejects.toThrow(
    'Ngrok tunnel web-preview-fixed.example.test stop timed out'
  );
  await jest.advanceTimersByTimeAsync(4_000);
  await rejected;
  expect(replacement.close).toHaveBeenCalledTimes(1);
});

it('retries a rejected close during shutdown', async () => {
  const failure = new Error('agent disconnected');
  initial.close.mockRejectedValueOnce(failure);
  const tunnel = await startNgrokTunnelAsync(options);
  const stopping = tunnel.stopAsync();
  await jest.advanceTimersByTimeAsync(250);
  await stopping;
  expect(initial.close).toHaveBeenCalledTimes(2);
  expect(logger.warn).toHaveBeenCalledTimes(1);
  expect(logger.warn).toHaveBeenCalledWith(
    { err: failure },
    'Could not stop ngrok tunnel web-preview-fixed.example.test.'
  );
});

it('logs the first close rejection once while bounded shutdown retries it', async () => {
  const failure = new Error('agent disconnected');
  initial.close.mockRejectedValue(failure);
  const tunnel = await startNgrokTunnelAsync(options);
  const rejected = expect(tunnel.stopAsync()).rejects.toThrow('stop timed out');
  await jest.advanceTimersByTimeAsync(4_000);
  await rejected;
  expect(initial.close.mock.calls.length).toBeGreaterThan(1);
  expect(logger.warn).toHaveBeenCalledTimes(1);
  expect(logger.warn).toHaveBeenCalledWith(
    { err: failure },
    'Could not stop ngrok tunnel web-preview-fixed.example.test.'
  );
});

it('bounds shutdown during recovery without duplicating a pending native close', async () => {
  failPublicProbes();
  let finishClose!: () => void;
  initial.close.mockReturnValueOnce(new Promise<void>(resolve => (finishClose = resolve)));
  const tunnel = await startNgrokTunnelAsync(options);
  await jest.advanceTimersByTimeAsync(45_000);
  const stopping = tunnel.stopAsync();
  expect(tunnel.stopAsync()).toBe(stopping);
  const rejected = expect(stopping).rejects.toThrow(
    'Ngrok tunnel web-preview-fixed.example.test stop timed out after 4000ms'
  );
  await jest.advanceTimersByTimeAsync(4_000);
  await rejected;
  expect(initial.close).toHaveBeenCalledTimes(1);
  expect(ngrok.forward).toHaveBeenCalledTimes(1);
  const warnings = jest.mocked(logger.warn).mock.calls.length;
  finishClose();
  await jest.advanceTimersByTimeAsync(120_000);
  expect(logger.warn).toHaveBeenCalledTimes(warnings);
  expect(initial.close).toHaveBeenCalledTimes(1);
});

it('bounds a stalled listener close before reopening', async () => {
  failPublicProbes();
  initial.close.mockImplementationOnce(async () => await new Promise(() => {}));
  const tunnel = await startNgrokTunnelAsync(options);
  try {
    await jest.advanceTimersByTimeAsync(49_999);
    expect(ngrok.forward).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(ngrok.forward).toHaveBeenCalledTimes(2);
  } finally {
    const stopping = tunnel.stopAsync();
    const rejected = expect(stopping).rejects.toThrow(
      'Ngrok tunnel web-preview-fixed.example.test stop timed out'
    );
    await jest.advanceTimersByTimeAsync(4_000);
    await rejected;
  }
});

it('does not queue more native opens while a timed-out open is still pending', async () => {
  failPublicProbes();
  let resolveOpening!: (value: ngrok.Listener) => void;
  jest
    .mocked(ngrok.forward)
    .mockReset()
    .mockResolvedValueOnce(initial as never)
    .mockReturnValueOnce(
      new Promise(resolve => {
        resolveOpening = resolve;
      })
    )
    .mockResolvedValue(replacement as never);
  const tunnel = await startNgrokTunnelAsync(options);
  const late = listener();
  try {
    await jest.advanceTimersByTimeAsync(180_000);
    expect(ngrok.forward).toHaveBeenCalledTimes(2);
    resolveOpening(late as never);
    await jest.advanceTimersByTimeAsync(30_000);
    expect(late.close).toHaveBeenCalledTimes(1);
    expect(ngrok.forward).toHaveBeenCalledTimes(3);
  } finally {
    await tunnel.stopAsync();
  }
  expect(replacement.close).toHaveBeenCalledTimes(1);
});

it('bounds initial tunnel creation and retires a late listener', async () => {
  let resolveOpening!: (value: ngrok.Listener) => void;
  jest
    .mocked(ngrok.forward)
    .mockReset()
    .mockReturnValueOnce(
      new Promise(resolve => {
        resolveOpening = resolve;
      })
    );
  const opening = startNgrokTunnelAsync(options);
  const rejected = expect(opening).rejects.toThrow('Ngrok tunnel open timed out');
  await jest.advanceTimersByTimeAsync(15_000);
  await rejected;
  resolveOpening(initial as never);
  await jest.advanceTimersByTimeAsync(0);
  expect(initial.close).toHaveBeenCalledTimes(1);
});

it('retries a rejected close after initial tunnel creation timed out', async () => {
  let resolveOpening!: (value: ngrok.Listener) => void;
  jest
    .mocked(ngrok.forward)
    .mockReset()
    .mockReturnValueOnce(new Promise(resolve => (resolveOpening = resolve)));
  const opening = startNgrokTunnelAsync(options);
  const rejected = expect(opening).rejects.toThrow('Ngrok tunnel open timed out');
  await jest.advanceTimersByTimeAsync(15_000);
  await rejected;
  initial.close.mockRejectedValueOnce(new Error('temporary unlisten failure'));
  resolveOpening(initial as never);
  await jest.advanceTimersByTimeAsync(250);
  expect(initial.close).toHaveBeenCalledTimes(2);
});

it('retires only the late listener without blaming it for an older stuck listener', async () => {
  failPublicProbes();
  initial.close.mockRejectedValue(new Error('old session disconnected'));
  let resolveOpening!: (value: ngrok.Listener) => void;
  jest
    .mocked(ngrok.forward)
    .mockReset()
    .mockResolvedValueOnce(initial as never)
    .mockReturnValueOnce(new Promise(resolve => (resolveOpening = resolve)))
    .mockResolvedValue(replacement as never);
  const tunnel = await startNgrokTunnelAsync(options);
  try {
    await jest.advanceTimersByTimeAsync(60_000);
    const late = listener();
    resolveOpening(late as never);
    jest.mocked(turtleFetch).mockResolvedValue(new Response(undefined, { status: 200 }));
    await jest.advanceTimersByTimeAsync(4_000);
    expect(late.close).toHaveBeenCalledTimes(1);
    expect(
      jest
        .mocked(logger.warn)
        .mock.calls.some(([, message]) => message?.includes('Could not retire late'))
    ).toBe(false);
  } finally {
    initial.close.mockResolvedValue(undefined);
    await tunnel.stopAsync();
  }
});

it('recovers using actual HTTP health probes with a local ngrok adapter', async () => {
  const actualFetch = jest.requireActual<typeof import('node-fetch')>('node-fetch').default;
  const realSetTimeout = jest.requireActual<typeof import('node:timers')>('node:timers').setTimeout;
  let broken = true;
  const local = createServer((_req, res) => {
    res.writeHead(200);
    res.end('healthy');
  });
  const publicServer = createServer((_req, res) => {
    res.writeHead(broken ? 503 : 200);
    res.end('probe');
  });
  await Promise.all(
    [local, publicServer].map(
      server => new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    )
  );
  const publicUrl = `http://127.0.0.1:${(publicServer.address() as AddressInfo).port}`;
  let completedRequests = 0;
  jest.mocked(turtleFetch).mockImplementation(async (target, method, requestOptions) => {
    const response = await actualFetch(target, { ...requestOptions, method });
    completedRequests++;
    return response;
  });
  const first = listener(publicUrl);
  const next = listener(publicUrl);
  jest
    .mocked(ngrok.forward)
    .mockReset()
    .mockResolvedValueOnce(first as never)
    .mockImplementation(async () => {
      broken = false;
      return next as never;
    });
  const tunnel = await startNgrokTunnelAsync({
    ...options,
    port: (local.address() as AddressInfo).port,
  });
  try {
    for (let count = 0; count < 3; count++) {
      await jest.advanceTimersByTimeAsync(15_000);
      for (let turns = 0; turns < 50 && completedRequests < (count + 1) * 2; turns++) {
        await new Promise(resolve => realSetTimeout(resolve, 10));
      }
      expect(completedRequests).toBe((count + 1) * 2);
    }
    expect(ngrok.forward).toHaveBeenCalledTimes(2);
    expect(first.close).toHaveBeenCalledTimes(1);
    expect((await actualFetch(`${tunnel.url}/healthz`)).status).toBe(200);
  } finally {
    await tunnel.stopAsync();
    await Promise.all(
      [local, publicServer].map(
        server =>
          new Promise<void>((resolve, reject) =>
            server.close(err => (err ? reject(err) : resolve()))
          )
      )
    );
  }
  expect(next.close).toHaveBeenCalledTimes(1);
});

it('blocks HTTP and existing WebSockets on Stop even when ngrok cannot close', async () => {
  jest.useRealTimers();
  const actualFetch = jest.requireActual<typeof import('node-fetch')>('node-fetch').default;
  let requests = 0;
  let messages = 0;
  const backend = createServer((_request, response) => {
    requests++;
    response.end('owned backend');
  });
  const websockets = new WebSocketServer({ server: backend });
  websockets.on('connection', socket => {
    socket.on('message', data => {
      messages++;
      socket.send(data);
    });
  });
  backend.listen(0, '127.0.0.1');
  await once(backend, 'listening');
  const backendPort = (backend.address() as AddressInfo).port;
  const tunnel = await startNgrokTunnelAsync({
    ...options,
    port: backendPort,
    healthCheck: undefined,
  });
  const targetPort = (jest.mocked(ngrok.forward).mock.calls[0][0] as ngrok.Config).addr;
  const targetUrl = `http://127.0.0.1:${targetPort}`;
  const socket = new WebSocket(`ws://127.0.0.1:${targetPort}`);
  const opened = once(socket, 'open');
  try {
    expect(await (await actualFetch(targetUrl)).text()).toBe('owned backend');
    await opened;
    const echoed = once(socket, 'message');
    socket.send('before-stop');
    expect((await echoed)[0].toString()).toBe('before-stop');
    const closed = once(socket, 'close');
    initial.close.mockRejectedValue(new Error('agent disconnected'));
    const stopping = tunnel.stopAsync();
    const rejected = expect(stopping).rejects.toThrow('stop timed out after 4000ms');
    await expect(actualFetch(targetUrl, { timeout: 1_000 })).rejects.toThrow();
    await closed;
    expect(requests).toBe(1);
    expect(messages).toBe(1);
    expect(await (await actualFetch(`http://127.0.0.1:${backendPort}`)).text()).toBe(
      'owned backend'
    );
    await rejected;
    await expect(actualFetch(targetUrl, { timeout: 1_000 })).rejects.toThrow();
    expect(requests).toBe(2);
    expect(messages).toBe(1);
    const competing = createTcpServer();
    const conflict = once(competing, 'error');
    competing.listen(targetPort as number, '127.0.0.1');
    expect((await conflict)[0]).toMatchObject({ code: 'EADDRINUSE' });
  } finally {
    socket.terminate();
    for (const client of websockets.clients) {
      client.terminate();
    }
    websockets.close();
    backend.closeAllConnections();
    await new Promise<void>(resolve => backend.close(() => resolve()));
    await tunnel.stopAsync().catch(() => {});
  }
});

it('releases its local target when initial tunnel creation fails', async () => {
  jest.useRealTimers();
  jest.mocked(ngrok.forward).mockReset().mockRejectedValue(new Error('forward failed'));
  await expect(startNgrokTunnelAsync(options)).rejects.toThrow('forward failed');
  const targetPort = (jest.mocked(ngrok.forward).mock.calls[0][0] as ngrok.Config).addr;
  const server = createServer();
  server.listen(targetPort as number, '127.0.0.1');
  await once(server, 'listening');
  await new Promise<void>(resolve => server.close(() => resolve()));
});

it('preserves a full response for a half-closed slow reader', async () => {
  jest.useRealTimers();
  const payload = Buffer.alloc(4 * 1024 * 1024, 37);
  const backend = createTcpServer({ allowHalfOpen: true }, socket => {
    socket.resume();
    socket.on('end', () => socket.end(payload));
  });
  backend.listen(0, '127.0.0.1');
  await once(backend, 'listening');
  const tunnel = await startNgrokTunnelAsync({
    ...options,
    port: (backend.address() as AddressInfo).port,
    healthCheck: undefined,
  });
  const targetPort = (jest.mocked(ngrok.forward).mock.calls[0][0] as ngrok.Config).addr as number;
  const socket = createConnection({ host: '127.0.0.1', port: targetPort, allowHalfOpen: true });
  try {
    const chunks: Buffer[] = [];
    socket.on('data', chunk => chunks.push(chunk));
    const ended = once(socket, 'end');
    socket.pause();
    socket.end('request');
    await new Promise(resolve => setTimeout(resolve, 100));
    socket.resume();
    await ended;
    expect(Buffer.concat(chunks).equals(payload)).toBe(true);
  } finally {
    socket.destroy();
    await tunnel.stopAsync();
    await new Promise<void>(resolve => backend.close(() => resolve()));
  }
});

it.each(['resolve', 'reject'])(
  'releases the target after timed-out startup later %s',
  async outcome => {
    let resolveOpening!: (value: ngrok.Listener) => void;
    let rejectOpening!: (error: Error) => void;
    jest
      .mocked(ngrok.forward)
      .mockReset()
      .mockReturnValue(
        new Promise((resolve, reject) => {
          resolveOpening = resolve;
          rejectOpening = reject;
        })
      );
    const opening = startNgrokTunnelAsync(options);
    const rejected = expect(opening).rejects.toThrow('open timed out');
    await new Promise<void>(resolve => setImmediate(resolve));
    await jest.advanceTimersByTimeAsync(15_000);
    await rejected;
    const targetPort = (jest.mocked(ngrok.forward).mock.calls[0][0] as ngrok.Config).addr as number;
    if (outcome === 'resolve') {
      resolveOpening(replacement as never);
    } else {
      rejectOpening(new Error('forward failed'));
    }
    await jest.advanceTimersByTimeAsync(0);
    const server = createTcpServer();
    server.listen(targetPort, '127.0.0.1');
    await once(server, 'listening');
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
);

it('drains a full upload when the backend ends its response early', async () => {
  jest.useRealTimers();
  const payload = Buffer.alloc(4 * 1024 * 1024, 51);
  let received!: Buffer;
  let receivedRequest!: () => void;
  const completed = new Promise<void>(resolve => {
    receivedRequest = resolve;
  });
  const backend = createTcpServer({ allowHalfOpen: true }, socket => {
    const chunks: Buffer[] = [];
    socket.on('data', chunk => chunks.push(chunk));
    socket.on('end', () => {
      received = Buffer.concat(chunks);
      receivedRequest();
    });
    socket.pause();
    socket.end('early response');
    setTimeout(() => socket.resume(), 100);
  });
  backend.listen(0, '127.0.0.1');
  await once(backend, 'listening');
  const tunnel = await startNgrokTunnelAsync({
    ...options,
    port: (backend.address() as AddressInfo).port,
    healthCheck: undefined,
  });
  const targetPort = (jest.mocked(ngrok.forward).mock.calls[0][0] as ngrok.Config).addr as number;
  const socket = createConnection({ host: '127.0.0.1', port: targetPort, allowHalfOpen: true });
  try {
    socket.resume();
    socket.end(payload);
    await completed;
    expect(received.equals(payload)).toBe(true);
  } finally {
    socket.destroy();
    await tunnel.stopAsync();
    await new Promise<void>(resolve => backend.close(() => resolve()));
  }
});
