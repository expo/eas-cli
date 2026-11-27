import { once } from 'node:events';
import http from 'node:http';

import { createServeEmuPreviewCapture } from '../serveEmuPreviewCapture';

const token = 'hub-preview-token';
const serial = 'emulator-5556';
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0x00]);
const supportedProbe = { ok: true, options: ['automation', 'maxWidth', 'format', 'quality'] };

type RecordedRequest = {
  method?: string;
  url?: string;
  authorization?: string;
  contentType?: string;
  body: string;
};

let server: http.Server;
let port: number;
let requests: RecordedRequest[];
let respond: (req: http.IncomingMessage, res: http.ServerResponse) => void;

function respondWithScreenshot(headers: http.OutgoingHttpHeaders, body: Buffer = png) {
  respond = (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'image/png', ...headers });
    res.end(body);
  };
}

beforeEach(async () => {
  requests = [];
  respond = (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(supportedProbe));
  };
  server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    requests.push({
      method: req.method,
      url: req.url,
      authorization: req.headers.authorization,
      contentType: req.headers['content-type'],
      body: Buffer.concat(chunks).toString(),
    });
    respond(req, res);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  port = (server.address() as { port: number }).port;
});

afterEach(async () => {
  server.closeAllConnections();
  server.close();
  await once(server, 'close');
});

describe('isSupportedAsync', () => {
  it('sends the probe through the Hub mount with the session token', async () => {
    const capture = createServeEmuPreviewCapture({ port, token });
    await expect(capture.isSupportedAsync(new AbortController().signal)).resolves.toBe(true);
    expect(requests).toEqual([
      {
        method: 'GET',
        url: '/vendor/serve-emu/api/screenshot',
        authorization: `Bearer ${token}`,
        contentType: undefined,
        body: '',
      },
    ]);
  });

  it('reports no automation support for a 405 from an older Hub', async () => {
    respond = (_req, res) => {
      res.writeHead(405);
      res.end('method not allowed');
    };
    const capture = createServeEmuPreviewCapture({ port, token });
    await expect(capture.isSupportedAsync(new AbortController().signal)).resolves.toBe(false);
  });

  it('reports no automation support when the capabilities omit it', async () => {
    respond = (_req, res) => {
      res.end(JSON.stringify({ ok: true, options: ['maxWidth', 'format'] }));
    };
    const capture = createServeEmuPreviewCapture({ port, token });
    await expect(capture.isSupportedAsync(new AbortController().signal)).resolves.toBe(false);
  });

  it.each([401, 503])('rejects a failed probe with HTTP %i', async status => {
    respond = (_req, res) => {
      res.writeHead(status);
      res.end();
    };
    const capture = createServeEmuPreviewCapture({ port, token });
    await expect(capture.isSupportedAsync(new AbortController().signal)).rejects.toThrow(
      `serve-emu screenshot capability probe failed: ${status}`
    );
  });

  it.each([
    JSON.stringify({ ok: true, options: 'automation' }),
    JSON.stringify({ ok: true }),
    'null',
    '<html></html>',
  ])('rejects unexpected capability responses (%s)', async body => {
    respond = (_req, res) => res.end(body);
    const capture = createServeEmuPreviewCapture({ port, token });
    await expect(capture.isSupportedAsync(new AbortController().signal)).rejects.toThrow();
  });

  it('rejects when the probe response ends before its body is read', async () => {
    respond = (_req, res) => {
      res.writeHead(200, { 'Content-Length': 1024, Connection: 'close' });
      res.end(JSON.stringify(supportedProbe));
    };
    const capture = createServeEmuPreviewCapture({ port, token });
    await expect(capture.isSupportedAsync(new AbortController().signal)).rejects.toThrow();
  });

  it('rejects when the probe cannot reach the Hub', async () => {
    server.close();
    await once(server, 'close');
    const capture = createServeEmuPreviewCapture({ port, token });
    await expect(capture.isSupportedAsync(new AbortController().signal)).rejects.toThrow();
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
  });
});

describe('captureAsync', () => {
  it('posts an automated capture for the selected device and returns the rotation', async () => {
    respondWithScreenshot({
      'X-Expo-Screenshot-Metadata': JSON.stringify({
        width: 2400,
        height: 1080,
        displayRotation: 'landscape-left',
      }),
      'X-Expo-Screenshot-Artifact': 'disabled',
    });
    const capture = createServeEmuPreviewCapture({ port, token });
    await expect(capture.captureAsync(serial, new AbortController().signal)).resolves.toEqual({
      image: png,
      displayRotation: 'landscape-left',
    });
    expect(requests).toEqual([
      {
        method: 'POST',
        url: '/vendor/serve-emu/api/screenshot?device=emulator-5556',
        authorization: `Bearer ${token}`,
        contentType: 'application/json',
        body: JSON.stringify({ automation: true }),
      },
    ]);
  });

  it.each([
    [JSON.stringify({ width: 1080, height: 2400, displayRotation: 'portrait' }), 'portrait'],
    [JSON.stringify({ width: 0, height: 0, displayRotation: null }), undefined],
    [JSON.stringify({ displayRotation: 'sideways' }), undefined],
    [JSON.stringify('not metadata'), undefined],
    ['{not json', undefined],
    [undefined, undefined],
  ])('returns only a known display rotation from the header (%s)', async (header, expected) => {
    respondWithScreenshot(header === undefined ? {} : { 'X-Expo-Screenshot-Metadata': header });
    const capture = createServeEmuPreviewCapture({ port, token });
    await expect(capture.captureAsync(serial, new AbortController().signal)).resolves.toEqual(
      expected ? { image: png, displayRotation: expected } : { image: png }
    );
  });

  it.each([
    [503, JSON.stringify({ ok: false, error: 'device emulator-5554 is not connected' })],
    [400, JSON.stringify({ ok: false, error: 'Invalid screenshot request' })],
    [500, 'internal error'],
  ])('rejects an HTTP %i answer with its error', async (status, body) => {
    respond = (_req, res) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(body);
    };
    const capture = createServeEmuPreviewCapture({ port, token });
    const message = `serve-emu screenshot request failed: ${status}`;
    await expect(capture.captureAsync(serial, new AbortController().signal)).rejects.toThrow(
      status === 500 ? message : `${message} ${JSON.parse(body).error}`
    );
  });

  it('rejects an answer that is not a PNG', async () => {
    respond = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    };
    const capture = createServeEmuPreviewCapture({ port, token });
    await expect(capture.captureAsync(serial, new AbortController().signal)).rejects.toThrow(
      'serve-emu screenshot returned application/json.'
    );
  });

  it('rejects an empty image', async () => {
    respondWithScreenshot({}, Buffer.alloc(0));
    const capture = createServeEmuPreviewCapture({ port, token });
    await expect(capture.captureAsync(serial, new AbortController().signal)).rejects.toThrow(
      'serve-emu screenshot returned an empty image.'
    );
  });

  it('sends nothing when the preview was already stopped', async () => {
    const controller = new AbortController();
    controller.abort(new Error('session stopped'));
    const capture = createServeEmuPreviewCapture({ port, token });
    await expect(capture.captureAsync(serial, controller.signal)).rejects.toThrow(
      'session stopped'
    );
    expect(requests).toEqual([]);
  });

  it('closes a pending capture when the preview stops', async () => {
    const controller = new AbortController();
    let received!: () => void;
    const requestReceived = new Promise<void>(resolve => {
      received = resolve;
    });
    // Hold the answer, as a slow capture would.
    respond = () => received();
    const capture = createServeEmuPreviewCapture({ port, token });
    const result = capture.captureAsync(serial, controller.signal);
    await requestReceived;
    controller.abort(new Error('session stopped'));
    await expect(result).rejects.toThrow('session stopped');
  });

  it('times out a capture after 30 seconds', async () => {
    const timeout = new AbortController();
    const spy = jest.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal);
    try {
      let received!: () => void;
      const requestReceived = new Promise<void>(resolve => {
        received = resolve;
      });
      respond = () => received();
      const capture = createServeEmuPreviewCapture({ port, token });
      const result = capture.captureAsync(serial, new AbortController().signal);
      await requestReceived;
      expect(spy).toHaveBeenCalledWith(30_000);
      timeout.abort(new Error('capture timed out'));
      await expect(result).rejects.toThrow('capture timed out');
    } finally {
      spy.mockRestore();
    }
  });
});
