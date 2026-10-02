import { type bunyan } from '@expo/logger';
import * as ngrok from '@ngrok/ngrok';
import { createServer } from 'node:http';
import { type AddressInfo } from 'node:net';

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
  jest.useFakeTimers();
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
      addr: 4321,
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
  await stopping;
  resolveOpening(replacement as never);
  await jest.advanceTimersByTimeAsync(0);
  expect(replacement.close).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(120_000);
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
  initial.close.mockRejectedValue(new Error('agent disconnected'));
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
  expect(replacement.close).toHaveBeenCalledTimes(1);
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
    await tunnel.stopAsync();
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
