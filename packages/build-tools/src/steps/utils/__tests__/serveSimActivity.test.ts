import { type bunyan } from '@expo/logger';
import { once } from 'node:events';
import http from 'node:http';

import { fetchLatestServeSimEventIdAsync, startServeSimActivityPolling } from '../serveSimActivity';

const token = 'test-session-token';
let server: http.Server;
let port: number;
let events: { id: number }[];
let status: number;
let requests: { url?: string; authorization?: string }[];
let rawBody: string | undefined;

function createLoggerMock(): bunyan {
  return { info: jest.fn(), warn: jest.fn() } as unknown as bunyan;
}

beforeEach(async () => {
  events = [];
  status = 200;
  requests = [];
  rawBody = undefined;
  server = http.createServer((req, res) => {
    requests.push({ url: req.url, authorization: req.headers.authorization });
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(rawBody ?? JSON.stringify({ events: events.slice(-1) }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  port = (server.address() as { port: number }).port;
});

afterEach(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
});

describe(fetchLatestServeSimEventIdAsync, () => {
  it('reads the newest event ID with the session token', async () => {
    events = [{ id: 3 }, { id: 7 }];
    await expect(fetchLatestServeSimEventIdAsync({ port, token })).resolves.toBe(7);
    expect(requests).toEqual([{ url: '/api/event-log?limit=1', authorization: `Bearer ${token}` }]);
  });

  it('returns undefined when serve-sim has logged no event', async () => {
    await expect(fetchLatestServeSimEventIdAsync({ port, token })).resolves.toBeUndefined();
  });

  it.each([
    ['unparseable JSON', 'not json'],
    ['a body without an events array', '{}'],
    ['an entry without a numeric ID', '{"events":[{"id":"7"}]}'],
  ])('rejects %s', async (_, body) => {
    rawBody = body;
    await expect(fetchLatestServeSimEventIdAsync({ port, token })).rejects.toThrow(
      'serve-sim event log'
    );
  });

  it('rejects a refused request', async () => {
    status = 401;
    await expect(fetchLatestServeSimEventIdAsync({ port, token })).rejects.toThrow('401');
  });
});

describe(startServeSimActivityPolling, () => {
  async function waitForRequestsAsync(count: number): Promise<void> {
    while (requests.length < count) {
      await new Promise(resolve => setTimeout(resolve, 5));
    }
  }

  it('reports activity only when a new event appears', async () => {
    const polling = startServeSimActivityPolling({
      port,
      token,
      logger: createLoggerMock(),
      pollIntervalMs: 10,
    });
    try {
      await waitForRequestsAsync(2);
      expect(polling.getLastActivityObservedAt()).toBeUndefined();

      events = [{ id: 1 }];
      const before = Date.now();
      await waitForRequestsAsync(requests.length + 2);
      const firstSeen = polling.getLastActivityObservedAt();
      expect(firstSeen?.getTime()).toBeGreaterThanOrEqual(before);

      await waitForRequestsAsync(requests.length + 2);
      expect(polling.getLastActivityObservedAt()).toBe(firstSeen);

      events = [{ id: 1 }, { id: 2 }];
      await waitForRequestsAsync(requests.length + 2);
      expect(polling.getLastActivityObservedAt()).not.toBe(firstSeen);
    } finally {
      await polling.stopAsync();
    }
  });

  it('reports current activity while the event log fails, and warns once', async () => {
    status = 500;
    const logger = createLoggerMock();
    const polling = startServeSimActivityPolling({ port, token, logger, pollIntervalMs: 10 });
    try {
      await waitForRequestsAsync(3);
      expect(logger.warn).toHaveBeenCalledTimes(1);
      const before = Date.now();
      expect(polling.getLastActivityObservedAt()?.getTime()).toBeGreaterThanOrEqual(before);

      status = 200;
      events = [{ id: 4 }];
      await waitForRequestsAsync(requests.length + 2);
      const observedAt = polling.getLastActivityObservedAt();
      await waitForRequestsAsync(requests.length + 2);
      expect(polling.getLastActivityObservedAt()).toBe(observedAt);
    } finally {
      await polling.stopAsync();
    }
  });

  it('keeps the last observation while serve-sim refuses connections', async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    server = http.createServer();
    const polling = startServeSimActivityPolling({
      port,
      token,
      logger: createLoggerMock(),
      pollIntervalMs: 10,
    });
    try {
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(polling.getLastActivityObservedAt()).toBeUndefined();
    } finally {
      await polling.stopAsync();
    }
  });

  it('reports current activity when serve-sim drops the connection mid-response', async () => {
    server.removeAllListeners('request');
    server.on('request', (req, res) => {
      requests.push({ url: req.url });
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': '100' });
      res.write('{"events":');
      setImmediate(() => res.socket?.destroy());
    });
    const polling = startServeSimActivityPolling({
      port,
      token,
      logger: createLoggerMock(),
      pollIntervalMs: 10,
    });
    try {
      await waitForRequestsAsync(3);
      const before = Date.now();
      expect(polling.getLastActivityObservedAt()?.getTime()).toBeGreaterThanOrEqual(before);
    } finally {
      await polling.stopAsync();
    }
  });

  it('reports current activity while serve-sim answers without an event log', async () => {
    status = 404;
    const polling = startServeSimActivityPolling({
      port,
      token,
      logger: createLoggerMock(),
      pollIntervalMs: 10,
    });
    try {
      await waitForRequestsAsync(2);
      const before = Date.now();
      expect(polling.getLastActivityObservedAt()?.getTime()).toBeGreaterThanOrEqual(before);

      status = 200;
      await waitForRequestsAsync(requests.length + 2);
      expect(polling.getLastActivityObservedAt()).toBeUndefined();
    } finally {
      await polling.stopAsync();
    }
  });

  it('stops polling after stopAsync', async () => {
    const polling = startServeSimActivityPolling({
      port,
      token,
      logger: createLoggerMock(),
      pollIntervalMs: 10,
    });
    await waitForRequestsAsync(1);
    await polling.stopAsync();
    const count = requests.length;
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(requests.length).toBe(count);
  });
});
