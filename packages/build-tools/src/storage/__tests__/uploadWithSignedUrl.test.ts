import { type IncomingMessage, type ServerResponse, createServer } from 'node:http';
import { performance } from 'node:perf_hooks';
import { Readable } from 'node:stream';

import {
  SignedUrlUploadApiError,
  SignedUrlUploadNetworkError,
  uploadWithSignedUrl,
} from '../uploadWithSignedUrl';

jest.unmock('node-fetch');

let handle: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>;
let server: ReturnType<typeof createServer>;
let origin: string;
let signedUrl: { url: string; headers: Record<string, string> };
let requests: number;

async function readBodyAsync(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString();
}

function respondWithStatuses(statuses: number[]): void {
  handle = async (request, response) => {
    await readBodyAsync(request);
    response.statusCode = statuses[requests - 1];
    response.end();
  };
}

beforeEach(async () => {
  requests = 0;
  server = createServer((request, response) => {
    requests++;
    void handle(request, response);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Missing test server address');
  }
  origin = `http://127.0.0.1:${address.port}`;
  signedUrl = { url: `${origin}/bucket/object?signature=secret-signature`, headers: {} };
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
});

describe(uploadWithSignedUrl, () => {
  it('sends the full body on every attempt', async () => {
    const bodies: string[] = [];
    handle = async (request, response) => {
      bodies.push(await readBodyAsync(request));
      response.statusCode = bodies.length === 1 ? 503 : 200;
      response.end();
    };
    const payload = '*'.repeat(128 * 1024);

    await uploadWithSignedUrl(
      { signedUrl, srcGeneratorAsync: async () => Readable.from([Buffer.from(payload)]) },
      { retryIntervalMs: 0 }
    );

    expect(bodies).toEqual([payload, payload]);
  });

  it('waits longer after each failed attempt', async () => {
    respondWithStatuses([503, 503, 200]);
    const startedAt = performance.now();

    await uploadWithSignedUrl(
      { signedUrl, srcGeneratorAsync: async () => Readable.from(['body']) },
      { retryIntervalMs: 100 }
    );

    expect(requests).toBe(3);
    expect(performance.now() - startedAt).toBeGreaterThanOrEqual(290);
  });

  it('does not retry a client error', async () => {
    handle = async (request, response) => {
      await readBodyAsync(request);
      response.statusCode = 403;
      response.end('<Error><Code>AccessDenied</Code></Error>');
    };

    const error = await uploadWithSignedUrl(
      { signedUrl, srcGeneratorAsync: async () => Readable.from(['body']) },
      { retryIntervalMs: 0 }
    ).catch(err => err);

    expect(error).toBeInstanceOf(SignedUrlUploadApiError);
    expect(error).toMatchObject({
      status: 403,
      reason: 'HTTP 403 Forbidden',
      message: 'Signed URL upload failed: HTTP 403 Forbidden.',
    });
    expect(requests).toBe(1);
  });

  it('retries a dropped connection', async () => {
    handle = async (request, response) => {
      if (requests === 1) {
        request.socket.destroy();
        return;
      }
      await readBodyAsync(request);
      response.end();
    };
    const srcGeneratorAsync = jest.fn(async () => Readable.from(['body']));

    await uploadWithSignedUrl({ signedUrl, srcGeneratorAsync }, { retryIntervalMs: 0 });

    expect(srcGeneratorAsync).toHaveBeenCalledTimes(2);
    expect(requests).toBe(2);
  });

  it('retries a refused connection and keeps the signed URL out of the error', async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    const srcGeneratorAsync = jest.fn(async () => Readable.from(['body']));

    const error = await uploadWithSignedUrl(
      { signedUrl, srcGeneratorAsync },
      { retries: 1, retryIntervalMs: 0 }
    ).catch(err => err);

    expect(error).toBeInstanceOf(SignedUrlUploadNetworkError);
    expect(error).toMatchObject({ code: 'ECONNREFUSED' });
    expect(error.message).not.toContain('secret-signature');
    expect(srcGeneratorAsync).toHaveBeenCalledTimes(2);
  });

  it('does not retry a network error outside the retryable codes', async () => {
    const srcGeneratorAsync = jest.fn(async () => Readable.from(['body']));

    const error = await uploadWithSignedUrl(
      {
        signedUrl: { ...signedUrl, url: signedUrl.url.replace('http:', 'https:') },
        srcGeneratorAsync,
      },
      { retryIntervalMs: 0 }
    ).catch(err => err);

    expect(error).toBeInstanceOf(SignedUrlUploadNetworkError);
    expect(error).toMatchObject({ code: 'EPROTO' });
    expect(srcGeneratorAsync).toHaveBeenCalledTimes(1);
  });

  it('propagates a source error without retrying, even with a retryable code', async () => {
    const sourceError = Object.assign(new Error('read failed'), { code: 'ECONNRESET' });
    const srcGeneratorAsync = jest.fn(async (): Promise<Readable> => {
      throw sourceError;
    });

    await expect(
      uploadWithSignedUrl({ signedUrl, srcGeneratorAsync }, { retryIntervalMs: 0 })
    ).rejects.toBe(sourceError);
    expect(srcGeneratorAsync).toHaveBeenCalledTimes(1);
    expect(requests).toBe(0);
  });

  it('retries an attempt that stalls past the stall timeout', async () => {
    handle = async (request, response) => {
      await readBodyAsync(request);
      if (requests > 1) {
        response.end();
      }
    };
    const streams: Readable[] = [];
    const srcGeneratorAsync = async (): Promise<Readable> => {
      const stream = Readable.from(['body']);
      streams.push(stream);
      return stream;
    };

    await uploadWithSignedUrl(
      { signedUrl, srcGeneratorAsync },
      { retryIntervalMs: 0, stallTimeoutMs: 100 }
    );

    expect(requests).toBe(2);
    expect(streams.every(stream => stream.destroyed)).toBe(true);
  });

  it('stops waiting for the next attempt when aborted', async () => {
    const controller = new AbortController();
    handle = async (request, response) => {
      await readBodyAsync(request);
      response.statusCode = 503;
      response.end();
      setTimeout(() => controller.abort(), 50);
    };

    await expect(
      uploadWithSignedUrl(
        { signedUrl, srcGeneratorAsync: async () => Readable.from(['body']) },
        { signal: controller.signal, retryIntervalMs: 60_000 }
      )
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(requests).toBe(1);
  });
});
