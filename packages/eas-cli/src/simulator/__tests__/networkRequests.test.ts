import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
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
import { fetchSimulatorPreviewAsync, streamSimulatorPreviewAsync } from '../preview';

jest.mock('../preview', () => ({
  ...jest.requireActual('../preview'),
  fetchSimulatorPreviewAsync: jest.fn(),
  streamSimulatorPreviewAsync: jest.fn(),
}));

const NOT_ENABLED_MESSAGE =
  'Network capture is not enabled for this session. Capture must be requested when the session starts. Start a new session with `eas simulator:start --network-capture`.';
const preview = {
  deviceRunSessionId: 'session-id',
  baseUrl: new URL('https://preview.test'),
  token: 'secret',
};
const signal = new AbortController().signal;
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
    .mockResolvedValue(new Response(typeof body === 'string' ? Readable.from([body]) : body));
}

function rejectOnTimeout(): AbortController {
  const controller = new AbortController();
  jest.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
  jest.mocked(fetchSimulatorPreviewAsync).mockImplementation(
    async (_preview, _route, options) =>
      await new Promise<Response>((_resolve, reject) => {
        if (options?.signal?.aborted) {
          reject(new Error('secret remote URL'));
        }
        options?.signal?.addEventListener('abort', () => {
          reject(new Error('secret remote URL'));
        });
      })
  );
  return controller;
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
      onData(typeof event === 'string' ? event : JSON.stringify(event));
    }
  });
}

beforeEach(async () => {
  jest.clearAllMocks();
  directory = await mkdtemp(path.join(os.tmpdir(), 'eas-inspection-test-'));
});

afterEach(async () => {
  jest.restoreAllMocks();
  await rm(directory, { recursive: true, force: true });
});

describe(readNetworkRequestsAsync, () => {
  it('keeps recent summaries without retaining captured bodies, including a final line without a newline', async () => {
    reply([entry('r1'), entry('r2'), entry('r3')].map(value => JSON.stringify(value)).join('\n'));
    const requests = await readNetworkRequestsAsync(preview, { limit: 2 });
    expect(fetchSimulatorPreviewAsync).toHaveBeenCalledWith(preview, '/network-capture.ndjson', {
      signal: expect.any(AbortSignal),
      notFoundMessage: NOT_ENABLED_MESSAGE,
    });
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

  it('returns selected captured headers and bodies without depending on the live request buffer', async () => {
    const request = entry('r1');
    reply(JSON.stringify(request));
    expect(await readNetworkRequestsAsync(preview, { limit: 100, requestId: 'r1' })).toEqual(
      request
    );
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
    await expect(
      readNetworkRequestsAsync(preview, { limit: 100, requestId: 'r1' })
    ).rejects.toThrow('not found');
  });

  it.each([
    'secret-body',
    '{"startedDateTime":"secret-body"}',
    JSON.stringify({ ...entry('r1'), startedDateTime: 'secret-body' }),
  ])('reports malformed data without echoing decrypted traffic %#', async data => {
    reply(data);
    const error = readNetworkRequestsAsync(preview, { limit: 100 });
    await expect(error).rejects.toThrow('Could not read the network capture.');
    await expect(error).rejects.not.toThrow('secret-body');
  });

  it('reports a capture deadline', async () => {
    const controller = rejectOnTimeout();
    const pending = readNetworkRequestsAsync(preview, { limit: 100 });
    const rejected = expect(pending).rejects.toThrow('The network capture request timed out.');
    controller.abort();
    await rejected;
    expect(AbortSignal.timeout).toHaveBeenCalledWith(10 * 60_000);
  });

  it('retains useful request failures', async () => {
    jest
      .mocked(fetchSimulatorPreviewAsync)
      .mockRejectedValue(new Error('Preview API access was refused.'));
    await expect(readNetworkRequestsAsync(preview, { limit: 100 })).rejects.toThrow(
      'Preview API access was refused.'
    );
  });
});

describe(streamNetworkRequestsAsync, () => {
  it('follows retained completed requests and emits live completions immediately', async () => {
    const requests: NetworkRequestSummary[] = [];
    jest
      .mocked(streamSimulatorPreviewAsync)
      .mockImplementation(async (_preview, _route, onData) => {
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

    await streamNetworkRequestsAsync(preview, request => requests.push(request), signal);

    expect(streamSimulatorPreviewAsync).toHaveBeenCalledWith(
      preview,
      '/network-capture',
      expect.any(Function),
      { signal, notFoundMessage: NOT_ENABLED_MESSAGE }
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

  it('keeps following when capture restarts, request IDs are reused, or events are unknown', async () => {
    streamEvents([
      { type: 'meta', meta: { attachment: 'capturing' }, initial: true },
      { type: 'session', udid: 'SIM-A' },
      { type: 'finished', request: capturedRequest('r1', 1000) },
      { type: 'cleared' },
      { type: 'meta', meta: { attachment: 'starting' } },
      { type: 'started', request: capturedRequest('r1', 2000) },
      { type: 'finished', request: capturedRequest('r1', 2000) },
      { type: 'evicted', id: 'r1' },
      { type: 'finished', request: capturedRequest('r2', 3000) },
    ]);
    const requests: NetworkRequestSummary[] = [];

    await streamNetworkRequestsAsync(preview, request => requests.push(request), signal);

    expect(requests.map(request => request.startedAt)).toEqual([1000, 2000, 3000]);
  });

  it.each([
    ['not-enabled', NOT_ENABLED_MESSAGE],
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

      await expect(streamNetworkRequestsAsync(preview, jest.fn(), signal)).rejects.toEqual(
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

    await expect(streamNetworkRequestsAsync(preview, onRequest, signal)).rejects.toThrow(
      'The network capture failed.'
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

    await expect(streamNetworkRequestsAsync(preview, onRequest, signal)).rejects.toThrow(
      'Network capture was turned off,'
    );
    expect(onRequest).toHaveBeenCalledTimes(1);
  });

  it.each(['secret-body', '{"type":"finished","request":{"url":"secret-body"}}'])(
    'reports malformed stream data without echoing decrypted traffic %#',
    async data => {
      streamEvents([data]);

      const error = streamNetworkRequestsAsync(preview, jest.fn(), signal);
      await expect(error).rejects.toThrow('Could not read the network capture stream.');
      await expect(error).rejects.not.toThrow('secret-body');
    }
  );

  it('preserves useful stream setup errors and returns after a clean shared interruption', async () => {
    jest
      .mocked(streamSimulatorPreviewAsync)
      .mockRejectedValueOnce(new Error('The simulator preview is offline.'))
      .mockResolvedValueOnce();

    await expect(streamNetworkRequestsAsync(preview, jest.fn(), signal)).rejects.toThrow(
      'The simulator preview is offline.'
    );
    await expect(streamNetworkRequestsAsync(preview, jest.fn(), signal)).resolves.toBeUndefined();
  });
});

describe(downloadNetworkCaptureAsync, () => {
  it('streams an exact HAR into a private file', async () => {
    const data = JSON.stringify({ log: { entries: [entry('r1')] } });
    reply(Readable.from([data.slice(0, 15), data.slice(15)]));
    const output = path.join(directory, 'capture.har');
    const oldUmask = process.umask(0);
    try {
      expect(await downloadNetworkCaptureAsync(preview, output)).toBe(output);
    } finally {
      process.umask(oldUmask);
    }
    expect(fetchSimulatorPreviewAsync).toHaveBeenCalledWith(preview, '/network-capture.har', {
      signal: expect.any(AbortSignal),
      notFoundMessage: NOT_ENABLED_MESSAGE,
    });
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
  });

  it('explains a missing output directory', async () => {
    reply('capture');
    await expect(
      downloadNetworkCaptureAsync(preview, path.join(directory, 'missing', 'capture.har'))
    ).rejects.toThrow('Check that the --output directory exists and is writable.');
    expect(await readdir(directory)).toEqual([]);
  });

  it('retains useful request errors without creating a file', async () => {
    jest
      .mocked(fetchSimulatorPreviewAsync)
      .mockRejectedValue(new Error('Start the session with --network-capture.'));
    await expect(
      downloadNetworkCaptureAsync(preview, path.join(directory, 'capture.har'))
    ).rejects.toThrow('--network-capture');
    expect(await readdir(directory)).toEqual([]);
  });

  it('removes the partial file after a failed transfer', async () => {
    reply(
      Readable.from(
        (async function* () {
          yield 'partial';
          throw new Error('secret remote URL');
        })()
      )
    );
    const error = downloadNetworkCaptureAsync(preview, path.join(directory, 'capture.har'));
    await expect(error).rejects.toThrow('Could not save the network capture.');
    await expect(error).rejects.not.toThrow('secret');
    expect(await readdir(directory)).toEqual([]);
  });

  it('reports a download deadline', async () => {
    const controller = rejectOnTimeout();
    const pending = downloadNetworkCaptureAsync(preview, path.join(directory, 'capture.har'));
    const rejected = expect(pending).rejects.toThrow('The network capture download timed out.');
    controller.abort();
    await rejected;
    expect(AbortSignal.timeout).toHaveBeenCalledWith(10 * 60_000);
    expect(await readdir(directory)).toEqual([]);
  });
});
