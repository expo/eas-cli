import { type bunyan } from '@expo/logger';
import { once } from 'node:events';
import http from 'node:http';

import {
  readExpoDeviceHubInputLogAsync,
  readServeSimInputLogAsync,
  startPreviewActivityPolling,
} from '../previewActivity';

const token = 'test-session-token';
let server: http.Server;
let port: number;
let events: { id: number; at?: string; timestamp?: string }[];
let status: number;
let requests: { url?: string; authorization?: string }[];
let rawBody: string | undefined;
let replaying: boolean;
let replayStartedAt: string | null;

function createLoggerMock(): bunyan {
  return { info: jest.fn(), warn: jest.fn() } as unknown as bunyan;
}

beforeEach(async () => {
  events = [];
  status = 200;
  requests = [];
  rawBody = undefined;
  replaying = false;
  replayStartedAt = null;
  server = http.createServer((req, res) => {
    requests.push({ url: req.url, authorization: req.headers.authorization });
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(rawBody ?? JSON.stringify({ events: events.slice(-1), replaying, replayStartedAt }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  port = (server.address() as { port: number }).port;
});

afterEach(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
});

describe(readServeSimInputLogAsync, () => {
  it('reads the newest event ID with the session token', async () => {
    events = [{ id: 3 }, { id: 7 }];
    await expect(readServeSimInputLogAsync({ port, token })).resolves.toEqual({
      latestEventId: 7,
      latestEventAt: undefined,
      replaying: false,
      replayStartedAt: undefined,
    });
    expect(requests).toEqual([{ url: '/api/event-log?limit=1', authorization: `Bearer ${token}` }]);
  });

  it('returns undefined when serve-sim has logged no event', async () => {
    await expect(readServeSimInputLogAsync({ port, token })).resolves.toEqual({
      latestEventId: undefined,
      latestEventAt: undefined,
      replaying: false,
      replayStartedAt: undefined,
    });
  });

  it.each([
    ['unparseable JSON', 'not json'],
    ['a body without an events array', '{}'],
    ['an entry without a numeric ID', '{"events":[{"id":"7"}]}'],
  ])('rejects %s', async (_, body) => {
    rawBody = body;
    await expect(readServeSimInputLogAsync({ port, token })).rejects.toThrow('serve-sim event log');
  });

  it('rejects a refused request', async () => {
    status = 401;
    await expect(readServeSimInputLogAsync({ port, token })).rejects.toThrow('401');
  });
});

describe(readExpoDeviceHubInputLogAsync, () => {
  it('reads the newest entry time from either server', async () => {
    events = [{ id: 2, timestamp: '2026-11-13T12:00:02.000Z' }];
    await expect(readServeSimInputLogAsync({ port, token })).resolves.toMatchObject({
      latestEventId: 2,
      latestEventAt: '2026-11-13T12:00:02.000Z',
    });
    events = [{ id: 3, at: '2026-11-13T12:00:03.000Z' }];
    await expect(readExpoDeviceHubInputLogAsync({ port, token })).resolves.toMatchObject({
      latestEventId: 3,
      latestEventAt: '2026-11-13T12:00:03.000Z',
    });
  });

  it('reads the newest recorded Android input through the hub with the session token', async () => {
    events = [{ id: 3 }, { id: 9 }];
    await expect(readExpoDeviceHubInputLogAsync({ port, token })).resolves.toEqual({
      latestEventId: 9,
      latestEventAt: undefined,
      replaying: false,
      replayStartedAt: undefined,
    });
    expect(requests).toEqual([
      { url: '/vendor/serve-emu/api/session?limit=1', authorization: `Bearer ${token}` },
    ]);
  });

  it('reports a running replay and when it started', async () => {
    replaying = true;
    replayStartedAt = '2026-11-13T12:00:00.000Z';
    await expect(readExpoDeviceHubInputLogAsync({ port, token })).resolves.toEqual({
      latestEventId: undefined,
      latestEventAt: undefined,
      replaying: true,
      replayStartedAt: '2026-11-13T12:00:00.000Z',
    });
  });

  it('reads replay state from the paged response shape', async () => {
    rawBody = JSON.stringify({
      events: [{ id: 4, at: '2026-11-13T12:00:01.000Z' }],
      session: { replaying: true, replayStartedAt: '2026-11-13T12:00:00.000Z' },
    });
    await expect(readExpoDeviceHubInputLogAsync({ port, token })).resolves.toEqual({
      latestEventId: 4,
      latestEventAt: '2026-11-13T12:00:01.000Z',
      replaying: true,
      replayStartedAt: '2026-11-13T12:00:00.000Z',
    });
  });

  it('returns no event ID when the hub has recorded no input', async () => {
    await expect(readExpoDeviceHubInputLogAsync({ port, token })).resolves.toEqual({
      latestEventId: undefined,
      latestEventAt: undefined,
      replaying: false,
      replayStartedAt: undefined,
    });
  });

  it.each([
    ['unparseable JSON', 'not json'],
    ['a body without an events array', '{}'],
    ['an entry without a numeric ID', '{"events":[{"id":"9"}]}'],
  ])('rejects %s', async (_, body) => {
    rawBody = body;
    await expect(readExpoDeviceHubInputLogAsync({ port, token })).rejects.toThrow(
      'expo-device-hub input log'
    );
  });
});

describe(startPreviewActivityPolling, () => {
  async function waitForRequestsAsync(count: number): Promise<void> {
    while (requests.length < count) {
      await new Promise(resolve => setTimeout(resolve, 5));
    }
  }

  it('reports activity only when a new event appears', async () => {
    const polling = startPreviewActivityPolling({
      server: 'serve-sim',
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
    const polling = startPreviewActivityPolling({
      server: 'serve-sim',
      port,
      token,
      logger,
      pollIntervalMs: 10,
    });
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
    const polling = startPreviewActivityPolling({
      server: 'serve-sim',
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
    const polling = startPreviewActivityPolling({
      server: 'serve-sim',
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
    const polling = startPreviewActivityPolling({
      server: 'serve-sim',
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

  it('reports Android preview input from expo-device-hub', async () => {
    const polling = startPreviewActivityPolling({
      server: 'expo-device-hub',
      port,
      token,
      logger: createLoggerMock(),
      pollIntervalMs: 10,
    });
    try {
      await waitForRequestsAsync(2);
      expect(polling.getLastActivityObservedAt()).toBeUndefined();
      expect(requests[0].url).toBe('/vendor/serve-emu/api/session?limit=1');

      events = [{ id: 1 }];
      const before = Date.now();
      await waitForRequestsAsync(requests.length + 2);
      expect(polling.getLastActivityObservedAt()?.getTime()).toBeGreaterThanOrEqual(before);
    } finally {
      await polling.stopAsync();
    }
  });

  it('reports activity while expo-device-hub replays recorded input', async () => {
    replaying = true;
    const polling = startPreviewActivityPolling({
      server: 'expo-device-hub',
      port,
      token,
      logger: createLoggerMock(),
      pollIntervalMs: 10,
    });
    try {
      await waitForRequestsAsync(2);
      const before = Date.now();
      await waitForRequestsAsync(requests.length + 2);
      expect(polling.getLastActivityObservedAt()?.getTime()).toBeGreaterThanOrEqual(before);
    } finally {
      await polling.stopAsync();
    }
  });

  it('reports a replay that started and finished between two reads', async () => {
    events = [{ id: 1 }];
    const polling = startPreviewActivityPolling({
      server: 'expo-device-hub',
      port,
      token,
      logger: createLoggerMock(),
      pollIntervalMs: 10,
    });
    try {
      await waitForRequestsAsync(2);
      const observedAt = polling.getLastActivityObservedAt();
      await waitForRequestsAsync(requests.length + 2);
      expect(polling.getLastActivityObservedAt()).toBe(observedAt);

      replayStartedAt = '2026-11-13T12:00:00.000Z';
      await waitForRequestsAsync(requests.length + 2);
      const replayObservedAt = polling.getLastActivityObservedAt();
      expect(replayObservedAt).not.toBe(observedAt);

      await waitForRequestsAsync(requests.length + 2);
      expect(polling.getLastActivityObservedAt()).toBe(replayObservedAt);
    } finally {
      await polling.stopAsync();
    }
  });

  it('counts input in a new recording that repeats the last ID between two reads', async () => {
    events = [{ id: 1, at: '2026-11-13T12:00:00.000Z' }];
    const polling = startPreviewActivityPolling({
      server: 'expo-device-hub',
      port,
      token,
      logger: createLoggerMock(),
      pollIntervalMs: 10,
    });
    try {
      await waitForRequestsAsync(2);
      const firstSeen = polling.getLastActivityObservedAt();
      expect(firstSeen).toBeDefined();
      await waitForRequestsAsync(requests.length + 2);
      expect(polling.getLastActivityObservedAt()).toBe(firstSeen);

      events = [{ id: 1, at: '2026-11-13T12:05:00.000Z' }];
      await waitForRequestsAsync(requests.length + 2);
      expect(polling.getLastActivityObservedAt()).not.toBe(firstSeen);
    } finally {
      await polling.stopAsync();
    }
  });

  it('counts input in a new recording whose IDs start again', async () => {
    events = [{ id: 1 }];
    const polling = startPreviewActivityPolling({
      server: 'expo-device-hub',
      port,
      token,
      logger: createLoggerMock(),
      pollIntervalMs: 10,
    });
    try {
      await waitForRequestsAsync(2);
      const firstSeen = polling.getLastActivityObservedAt();
      expect(firstSeen).toBeDefined();

      events = [];
      await waitForRequestsAsync(requests.length + 2);
      events = [{ id: 1 }];
      await waitForRequestsAsync(requests.length + 2);
      expect(polling.getLastActivityObservedAt()).not.toBe(firstSeen);
    } finally {
      await polling.stopAsync();
    }
  });

  it('keeps the last observation while an expo-device-hub read times out', async () => {
    events = [{ id: 1 }];
    let hang = false;
    server.removeAllListeners('request');
    server.on('request', (req, res) => {
      requests.push({ url: req.url });
      if (hang) {
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ events, replaying: false, replayStartedAt: null }));
    });
    const polling = startPreviewActivityPolling({
      server: 'expo-device-hub',
      port,
      token,
      logger: createLoggerMock(),
      pollIntervalMs: 10,
      requestTimeoutMs: 100,
    });
    try {
      while (polling.getLastActivityObservedAt() === undefined) {
        await new Promise(resolve => setTimeout(resolve, 5));
      }
      const observedAt = polling.getLastActivityObservedAt();

      hang = true;
      await waitForRequestsAsync(requests.length + 3);
      expect(polling.getLastActivityObservedAt()).toBe(observedAt);
    } finally {
      await polling.stopAsync();
      server.closeAllConnections();
    }
  });

  it('warns about an unreadable log after an earlier device outage', async () => {
    const logger = createLoggerMock();
    status = 503;
    const polling = startPreviewActivityPolling({
      server: 'expo-device-hub',
      port,
      token,
      logger,
      pollIntervalMs: 10,
    });
    try {
      await waitForRequestsAsync(2);
      expect(logger.warn).toHaveBeenCalledTimes(1);

      status = 500;
      await waitForRequestsAsync(requests.length + 2);
      expect(logger.warn).toHaveBeenCalledTimes(2);
      expect(jest.mocked(logger.warn).mock.calls[1][1]).toContain(
        'idle timeout does not stop this session'
      );
    } finally {
      await polling.stopAsync();
    }
  });

  it('keeps the last observation while expo-device-hub has no device', async () => {
    events = [{ id: 1 }];
    const polling = startPreviewActivityPolling({
      server: 'expo-device-hub',
      port,
      token,
      logger: createLoggerMock(),
      pollIntervalMs: 10,
    });
    try {
      await waitForRequestsAsync(2);
      const observedAt = polling.getLastActivityObservedAt();
      expect(observedAt).toBeDefined();

      status = 503;
      await waitForRequestsAsync(requests.length + 3);
      expect(polling.getLastActivityObservedAt()).toBe(observedAt);
    } finally {
      await polling.stopAsync();
    }
  });

  it('reports current activity when serve-sim answers 503', async () => {
    status = 503;
    const polling = startPreviewActivityPolling({
      server: 'serve-sim',
      port,
      token,
      logger: createLoggerMock(),
      pollIntervalMs: 10,
    });
    try {
      await waitForRequestsAsync(2);
      const before = Date.now();
      expect(polling.getLastActivityObservedAt()?.getTime()).toBeGreaterThanOrEqual(before);
    } finally {
      await polling.stopAsync();
    }
  });

  it('stops polling after stopAsync', async () => {
    const polling = startPreviewActivityPolling({
      server: 'serve-sim',
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
