import { mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { type AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

import { Response } from '../../fetch';
import {
  type NetworkRequest,
  type NetworkRequestSummary,
  downloadNetworkCaptureAsync,
  readNetworkRequestsAsync,
  streamNetworkRequestsAsync,
} from '../networkRequests';
import {
  type SimulatorPreview,
  SimulatorPreviewResponse,
  fetchSimulatorPreviewAsync,
  streamSimulatorPreviewAsync,
} from '../preview';

jest.mock('../preview', () => ({
  ...jest.requireActual('../preview'),
  fetchSimulatorPreviewAsync: jest.fn(),
  streamSimulatorPreviewAsync: jest.fn(),
}));

const preview = {
  deviceRunSessionId: 'session-id',
  baseUrl: new URL('https://preview.test'),
  token: 'secret',
};
let directory: string;

function entry(id: string): NetworkRequest {
  return {
    _captureId: id,
    _captureStartedAt: 123.45,
    startedDateTime: '2026-10-05T20:54:22.074Z',
    time: 82,
    request: { method: 'POST', url: 'https://example.test/posts', bodySize: 0, postData: null },
    response: { status: 201, bodySize: 12, content: { text: '{"id":101}' } },
  };
}

function reply(body: string | Readable): void {
  jest
    .mocked(fetchSimulatorPreviewAsync)
    .mockResolvedValue(
      new Response(
        typeof body === 'string' ? Readable.from([body]) : body
      ) as SimulatorPreviewResponse
    );
}

function capturedRequest(
  id: string,
  startedAt = Date.parse(entry(id).startedDateTime)
): {
  id: string;
  startedAt: number;
  method: string;
  url: string;
  status: number;
  durationMs: number;
  requestBytes: number;
  responseBytes: number;
} {
  return {
    id,
    startedAt,
    method: 'POST',
    url: 'https://example.test/posts',
    status: 201,
    durationMs: 82,
    requestBytes: 0,
    responseBytes: 12,
  };
}

function streamEvents(events: unknown[]): void {
  jest.mocked(streamSimulatorPreviewAsync).mockImplementation(async (_preview, _route, onData) => {
    for (const event of events) {
      try {
        onData(JSON.stringify(event));
      } catch {
        throw new Error('The simulator preview stream ended unexpectedly.');
      }
    }
  });
}

beforeEach(async () => {
  jest.clearAllMocks();
  directory = await mkdtemp(path.join(os.tmpdir(), 'eas-inspection-test-'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

it('keeps recent summaries without retaining captured bodies, including a final line without a newline', async () => {
  reply([entry('r1'), entry('r2'), entry('r3')].map(value => JSON.stringify(value)).join('\n'));
  const requests = await readNetworkRequestsAsync(preview, { limit: 2 });
  expect(requests).toEqual(
    ['r2', 'r3'].map(id => ({
      id,
      startedAt: 123.45,
      startedDateTime: '2026-10-05T20:54:22.074Z',
      method: 'POST',
      url: 'https://example.test/posts',
      status: 201,
      duration: 82,
      requestSize: 0,
      responseSize: 12,
    }))
  );
});

it('orders snapshots by start date and limits the latest starts rather than completions', async () => {
  const entries = [
    { ...entry('r3'), startedDateTime: '2026-10-05T20:54:24.000Z', _captureStartedAt: 1 },
    { ...entry('r1'), startedDateTime: '2026-10-05T20:54:22.000Z', _captureStartedAt: 3 },
    { ...entry('r2'), startedDateTime: '2026-10-05T20:54:23.000Z', _captureStartedAt: 2 },
  ];
  reply(entries.map(value => JSON.stringify(value)).join('\n'));
  expect(await readNetworkRequestsAsync(preview, { limit: 2 })).toEqual([
    expect.objectContaining({ id: 'r2' }),
    expect.objectContaining({ id: 'r3' }),
  ]);

  reply(entries.map(value => JSON.stringify(value)).join('\n'));
  expect(await readNetworkRequestsAsync(preview, { limit: 1 })).toEqual([
    expect.objectContaining({ id: 'r3' }),
  ]);
});

it('uses fractional start times and numeric request IDs to order equal start dates', async () => {
  const entries = [
    { ...entry('r10'), _captureStartedAt: 123.45 },
    { ...entry('r3'), _captureStartedAt: 123.5 },
    { ...entry('r2'), _captureStartedAt: 123.45 },
  ];
  reply(entries.map(value => JSON.stringify(value)).join('\n'));

  expect(await readNetworkRequestsAsync(preview, { limit: 2 })).toEqual([
    expect.objectContaining({ id: 'r10' }),
    expect.objectContaining({ id: 'r3' }),
  ]);
});

it('follows retained completed requests and emits live completions immediately', async () => {
  const requests: NetworkRequestSummary[] = [];
  jest.mocked(streamSimulatorPreviewAsync).mockImplementation(async (_preview, _route, onData) => {
    onData(JSON.stringify({ type: 'meta', meta: { attachment: 'starting' }, initial: true }));
    onData(JSON.stringify({ type: 'meta', meta: { attachment: 'capturing' } }));
    onData(JSON.stringify({ type: 'finished', request: capturedRequest('r1', 1000) }));
    onData(JSON.stringify({ type: 'finished', request: capturedRequest('r2', 2000) }));
    onData(JSON.stringify({ type: 'started', request: capturedRequest('r3', 3000) }));
    onData(JSON.stringify({ type: 'finished', request: capturedRequest('r4', 4000) }));
    expect(requests.map(request => request.id)).toEqual(['r1', 'r2', 'r4']);
    onData(
      JSON.stringify({
        type: 'finished',
        request: { ...capturedRequest('r3', 3000), status: null, durationMs: null },
      })
    );
  });

  await streamNetworkRequestsAsync(preview, request => requests.push(request));

  expect(streamSimulatorPreviewAsync).toHaveBeenCalledWith(
    preview,
    '/network-capture',
    expect.any(Function)
  );
  expect(fetchSimulatorPreviewAsync).not.toHaveBeenCalled();
  expect(requests.map(request => request.id)).toEqual(['r1', 'r2', 'r4', 'r3']);
  expect(requests[3]).toEqual({
    id: 'r3',
    startedAt: 3000,
    startedDateTime: '1970-01-01T00:00:03.000Z',
    method: 'POST',
    url: 'https://example.test/posts',
    status: 0,
    duration: 0,
    requestSize: 0,
    responseSize: 12,
  });
});

it('keeps following when capture restarts and request IDs are reused', async () => {
  streamEvents([
    { type: 'meta', meta: { attachment: 'capturing' }, initial: true },
    { type: 'finished', request: capturedRequest('r1', 1000) },
    { type: 'cleared' },
    { type: 'meta', meta: { attachment: 'starting' } },
    { type: 'started', request: capturedRequest('r1', 2000) },
    { type: 'finished', request: capturedRequest('r1', 2000) },
    { type: 'evicted', id: 'r1' },
    { type: 'finished', request: capturedRequest('r2', 3000) },
  ]);
  const requests: NetworkRequestSummary[] = [];

  await streamNetworkRequestsAsync(preview, request => requests.push(request));

  expect(requests.map(request => request.startedAt)).toEqual([1000, 2000, 3000]);
});

it.each([
  [
    'not-enabled',
    'Network capture is not enabled for this session. Capture must be requested when the session starts. Start a new session with `eas simulator:start --network-capture`.',
  ],
  [
    'failed',
    'The network capture failed. The session reported a capture error. Open the session preview to see the error, or start a new session with `eas simulator:start --network-capture`.',
  ],
])(
  'reports the %s capture state without exposing attachment errors',
  async (attachment, message) => {
    streamEvents([
      { type: 'meta', meta: { attachment, attachError: 'secret remote URL' }, initial: true },
    ]);

    await expect(streamNetworkRequestsAsync(preview, jest.fn())).rejects.toEqual(
      new Error(message)
    );
  }
);

it('stops on capture failure after emitting earlier completed requests', async () => {
  streamEvents([
    { type: 'meta', meta: { attachment: 'capturing' } },
    { type: 'finished', request: capturedRequest('r1') },
    { type: 'meta', meta: { attachment: 'failed' } },
    { type: 'finished', request: capturedRequest('r2') },
  ]);
  const onRequest = jest.fn();

  await expect(streamNetworkRequestsAsync(preview, onRequest)).rejects.toEqual(
    new Error(
      'The network capture failed. The session reported a capture error. Open the session preview to see the error, or start a new session with `eas simulator:start --network-capture`.'
    )
  );
  expect(onRequest).toHaveBeenCalledTimes(1);
});

it('explains when capture is turned off after following has started', async () => {
  streamEvents([
    { type: 'meta', meta: { attachment: 'capturing' }, initial: true },
    { type: 'finished', request: capturedRequest('r1', 1000) },
    { type: 'meta', meta: { attachment: 'not-enabled' } },
  ]);
  const onRequest = jest.fn();

  await expect(streamNetworkRequestsAsync(preview, onRequest)).rejects.toThrow(
    'Network capture was turned off,'
  );
  expect(onRequest).toHaveBeenCalledTimes(1);
});

it.each(['secret-body', '{"type":"finished","request":{"url":"secret-body"}}'])(
  'reports malformed stream data without echoing decrypted traffic %#',
  async data => {
    jest
      .mocked(streamSimulatorPreviewAsync)
      .mockImplementation(async (_preview, _route, onData) => {
        try {
          onData(data);
        } catch {
          throw new Error('The simulator preview stream ended unexpectedly.');
        }
      });

    await expect(streamNetworkRequestsAsync(preview, jest.fn())).rejects.toThrow(
      'Could not read the network capture stream.'
    );
  }
);

it('preserves useful stream setup errors and returns after a clean shared interruption', async () => {
  jest
    .mocked(streamSimulatorPreviewAsync)
    .mockRejectedValueOnce(new Error('The simulator preview is offline.'))
    .mockResolvedValueOnce();

  await expect(streamNetworkRequestsAsync(preview, jest.fn())).rejects.toThrow(
    'The simulator preview is offline.'
  );
  await expect(streamNetworkRequestsAsync(preview, jest.fn())).resolves.toBeUndefined();
});

it('returns selected captured headers and bodies without depending on the live request buffer', async () => {
  const request = entry('r1');
  reply(JSON.stringify(request));
  expect(await readNetworkRequestsAsync(preview, { limit: 100, requestId: 'r1' })).toEqual(request);
});

it('handles UTF-8 split across chunks', async () => {
  const bytes = Buffer.from(
    JSON.stringify({
      ...entry('r1'),
      request: { ...entry('r1').request, url: 'https://example.test/é' },
    })
  );
  const split = bytes.indexOf(Buffer.from('é')) + 1;
  reply(Readable.from([bytes.subarray(0, split), bytes.subarray(split)]));
  const result = await readNetworkRequestsAsync(preview, { limit: 1 });
  expect(result).toEqual([expect.objectContaining({ url: 'https://example.test/é' })]);
});

it('returns an empty list for an empty capture and reports a missing request', async () => {
  reply('');
  expect(await readNetworkRequestsAsync(preview, { limit: 100 })).toEqual([]);
  reply('');
  await expect(readNetworkRequestsAsync(preview, { limit: 100, requestId: 'r1' })).rejects.toThrow(
    'not found'
  );
});

it.each([
  'secret-body',
  '{"startedDateTime":"secret-body"}',
  JSON.stringify({ ...entry('r1'), startedDateTime: 'secret-body' }),
])('reports malformed data without echoing decrypted traffic %#', async data => {
  reply(data);
  await expect(readNetworkRequestsAsync(preview, { limit: 100 })).rejects.toThrow(
    'Could not read the network capture.'
  );
});

it('reports a capture deadline while retaining useful request failures', async () => {
  const controller = new AbortController();
  const timeout = jest.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
  try {
    jest.mocked(fetchSimulatorPreviewAsync).mockImplementation(
      async (_preview, _route, _query, init) =>
        await new Promise<SimulatorPreviewResponse>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new Error('secret remote URL'));
          });
        })
    );
    const pending = readNetworkRequestsAsync(preview, { limit: 100 });
    const rejected = expect(pending).rejects.toThrow('The network capture request timed out.');
    controller.abort();
    await rejected;
    expect(timeout).toHaveBeenCalledWith(10 * 60_000);
  } finally {
    timeout.mockRestore();
  }

  jest
    .mocked(fetchSimulatorPreviewAsync)
    .mockRejectedValue(new Error('Preview API access was refused.'));
  await expect(readNetworkRequestsAsync(preview, { limit: 100 })).rejects.toThrow(
    'Preview API access was refused.'
  );
});

it('streams an exact HAR into a private file and removes staging files', async () => {
  const data = JSON.stringify({ log: { entries: [entry('r1')] } });
  reply(Readable.from([data.slice(0, 15), data.slice(15)]));
  const output = path.join(directory, 'capture.har');
  const oldUmask = process.umask(0);
  try {
    expect(await downloadNetworkCaptureAsync(preview, output)).toBe(output);
  } finally {
    process.umask(oldUmask);
  }
  expect(await readFile(output, 'utf8')).toBe(data);
  expect((await stat(output)).mode & 0o777).toBe(0o600);
  expect(await readdir(directory)).toEqual(['capture.har']);
});

it('refuses an existing file before requesting the capture', async () => {
  const output = path.join(directory, 'capture.har');
  await writeFile(output, 'keep');
  reply('new capture');
  await expect(downloadNetworkCaptureAsync(preview, output)).rejects.toThrow('already exists');
  expect(fetchSimulatorPreviewAsync).not.toHaveBeenCalled();
  expect(await readFile(output, 'utf8')).toBe('keep');
  expect(await readdir(directory)).toEqual(['capture.har']);
});

it('refuses a broken destination symlink before requesting the capture', async () => {
  const output = path.join(directory, 'capture.har');
  await symlink(path.join(directory, 'missing-target'), output);

  await expect(downloadNetworkCaptureAsync(preview, output)).rejects.toThrow('already exists');

  expect(fetchSimulatorPreviewAsync).not.toHaveBeenCalled();
  expect(await readdir(directory)).toEqual(['capture.har']);
});

it('does not overwrite a file created during the download', async () => {
  const output = path.join(directory, 'capture.har');
  jest.mocked(fetchSimulatorPreviewAsync).mockImplementation(async () => {
    await writeFile(output, 'created concurrently');
    return new Response(Readable.from(['new capture'])) as SimulatorPreviewResponse;
  });

  await expect(downloadNetworkCaptureAsync(preview, output)).rejects.toThrow('already exists');

  expect(fetchSimulatorPreviewAsync).toHaveBeenCalledTimes(1);
  expect(await readFile(output, 'utf8')).toBe('created concurrently');
  expect(await readdir(directory)).toEqual(['capture.har']);
});

it('explains a missing output directory before requesting the capture', async () => {
  await expect(
    downloadNetworkCaptureAsync(preview, path.join(directory, 'missing', 'capture.har'))
  ).rejects.toThrow('The --output directory does not exist or is not writable.');

  expect(fetchSimulatorPreviewAsync).not.toHaveBeenCalled();
  expect(await readdir(directory)).toEqual([]);
});

it('retains useful request errors and cleans staging files', async () => {
  jest
    .mocked(fetchSimulatorPreviewAsync)
    .mockRejectedValue(new Error('Start the session with --network-capture.'));
  await expect(
    downloadNetworkCaptureAsync(preview, path.join(directory, 'capture.har'))
  ).rejects.toThrow('--network-capture');
  expect(await readdir(directory)).toEqual([]);
});

it('cleans partial downloads after an interrupted transfer', async () => {
  const body = Readable.from(
    (async function* () {
      yield 'partial';
      throw new Error('secret remote URL');
    })()
  );
  reply(body);
  await expect(
    downloadNetworkCaptureAsync(preview, path.join(directory, 'capture.har'))
  ).rejects.toThrow('Could not save');
  expect(await readdir(directory)).toEqual([]);
});

it('cleans a never-ending download after SIGINT and removes its listener', async () => {
  let started: () => void = () => {};
  const reading = new Promise<void>(resolve => {
    started = resolve;
  });
  let sent = false;
  const body = new Readable({
    read() {
      if (!sent) {
        sent = true;
        this.push('partial capture');
        started();
      }
    },
  });
  reply(body);
  const listeners = process.listeners('SIGINT');
  const pending = downloadNetworkCaptureAsync(preview, path.join(directory, 'capture.har'));
  const rejected = expect(pending).rejects.toThrow('The network capture download was interrupted.');

  await reading;
  process.emit('SIGINT');
  await rejected;

  expect(body.destroyed).toBe(true);
  expect(await readdir(directory)).toEqual([]);
  expect(process.listeners('SIGINT')).toEqual(listeners);
});

it.each(['interrupted', 'timed out'])(
  'reports a download %s before response headers and cleans staging files',
  async reason => {
    let started: () => void = () => {};
    const fetching = new Promise<void>(resolve => {
      started = resolve;
    });
    const listeners = process.listeners('SIGINT');
    if (reason === 'timed out') {
      jest.useFakeTimers();
    }
    try {
      jest.mocked(fetchSimulatorPreviewAsync).mockImplementation(
        async (_preview, _route, _query, init) =>
          await new Promise<SimulatorPreviewResponse>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              reject(new Error('secret remote URL'));
            });
            started();
          })
      );
      const pending = downloadNetworkCaptureAsync(preview, path.join(directory, 'capture.har'));
      const rejected = expect(pending).rejects.toThrow(
        reason === 'interrupted'
          ? 'The network capture download was interrupted.'
          : 'The network capture download timed out.'
      );
      await fetching;
      if (reason === 'interrupted') {
        process.emit('SIGINT');
      } else {
        jest.advanceTimersByTime(10 * 60_000);
      }
      await rejected;
      expect(await readdir(directory)).toEqual([]);
      expect(process.listeners('SIGINT')).toEqual(listeners);
    } finally {
      jest.useRealTimers();
    }
  }
);

it('closes the HTTP connection after rejecting a malformed capture stream', async () => {
  await withCaptureServerAsync(async httpPreview => {
    await expect(readNetworkRequestsAsync(httpPreview, { limit: 100 })).rejects.toThrow(
      'Could not read the network capture.'
    );
  });
});

it('closes the HTTP connection after the HAR output stream fails', async () => {
  const fs = jest.requireActual<typeof import('node:fs')>('node:fs');
  const createWriteStream = fs.createWriteStream;
  const failingOutput = jest
    .spyOn(fs, 'createWriteStream')
    .mockImplementation(() => createWriteStream(path.join(directory, 'missing', 'capture.har')));
  try {
    await withCaptureServerAsync(async httpPreview => {
      await expect(
        downloadNetworkCaptureAsync(httpPreview, path.join(directory, 'capture.har'))
      ).rejects.toThrow('Could not save the network capture.');
      expect(await readdir(directory)).toEqual([]);
    });
  } finally {
    failingOutput.mockRestore();
  }
});

async function withCaptureServerAsync(
  assertAsync: (httpPreview: SimulatorPreview) => Promise<void>
): Promise<void> {
  let close: () => void = () => {};
  const closed = new Promise<void>(resolve => {
    close = resolve;
  });
  const server = createServer((_request, response) => {
    response.once('close', close);
    response.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
    response.write('secret-body\n');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  jest
    .mocked(fetchSimulatorPreviewAsync)
    .mockImplementation(
      jest.requireActual<typeof import('../preview')>('../preview').fetchSimulatorPreviewAsync
    );
  let timeout: NodeJS.Timeout | undefined;
  try {
    await assertAsync({ ...preview, baseUrl: new URL(`http://127.0.0.1:${port}`) });
    await Promise.race([
      closed,
      new Promise<void>((_resolve, reject) => {
        timeout = setTimeout(() => {
          reject(new Error('The preview connection remained open.'));
        }, 1_000);
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
}
