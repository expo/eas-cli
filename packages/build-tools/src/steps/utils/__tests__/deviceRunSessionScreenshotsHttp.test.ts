import type { bunyan } from '@expo/logger';
import { Client, fetchExchange } from '@urql/core';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { type IncomingMessage, type ServerResponse, createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { CustomBuildContext } from '../../../customBuildContext';
import { loadScreenshotSessionAsync } from '../deviceRunSessionScreenshotNames';
import { uploadDeviceRunSessionScreenshotsAsync } from '../deviceRunSessionScreenshots';
jest.unmock('node-fetch');
jest.mock('../../../sentry');
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => {
    resolve = r;
  });
  return { promise, resolve };
}

let handle: (request: IncomingMessage, response: ServerResponse) => void;
let server: ReturnType<typeof createServer>;
let ctx: CustomBuildContext;
let url: string;
let directory: string;
let creates: number;
let authorization: string | undefined;
let stallCreation: boolean;
let creationStarted: ReturnType<typeof deferred<IncomingMessage>>;
let creationBodies: string[];
const installedCommit = 'a1b2c3d' + '0'.repeat(33);
let sessionLookupFails: boolean;
let sessionLookups: number;
let uploadQuery: string;

beforeEach(async () => {
  creates = 0;
  sessionLookups = 0;
  sessionLookupFails = false;
  uploadQuery = '';
  authorization = undefined;
  stallCreation = false;
  creationBodies = [];
  creationStarted = deferred();
  directory = await mkdtemp(path.join(tmpdir(), 'recording-upload-http-'));
  server = createServer((request, response) => {
    if (request.url?.startsWith('/graphql')) {
      authorization = request.headers.authorization;
      request.setEncoding('utf8');
      let body = '';
      if (request.method === 'GET') {
        const requestUrl = new URL(request.url, 'http://localhost');
        body = JSON.stringify({ query: requestUrl.searchParams.get('query') });
      }
      request.on('data', chunk => (body += chunk));
      request.on('end', () => {
        const operation = JSON.parse(body);
        if (operation.query.includes('query ScreenshotSession')) {
          sessionLookups++;
          response.setHeader('Content-Type', 'application/json');
          if (sessionLookupFails) {
            response.end(JSON.stringify({ errors: [{ message: 'Lookup unavailable' }] }));
          } else {
            response.end(
              JSON.stringify({
                data: {
                  deviceRunSessions: {
                    byId: {
                      platform: 'IOS',
                      app: { slug: 'session-project' },
                      build: {
                        id: 'installed-build',
                        gitCommitHash: installedCommit,
                        app: { slug: 'my-app' },
                      },
                    },
                  },
                },
              })
            );
          }
          return;
        }
        creates++;
        creationBodies.push(body);
        creationStarted.resolve(request);
        if (stallCreation) {
          return;
        }
        response.setHeader('Content-Type', 'application/json');
        response.end(
          JSON.stringify({
            data: {
              deviceRunSession: {
                createArtifactUploadSession: {
                  uploadSession: { url: `${url}/artifact${uploadQuery}`, headers: {} },
                },
              },
            },
          })
        );
      });
    } else {
      handle(request, response);
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Missing test server address');
  }
  url = `http://127.0.0.1:${address.port}`;
  ctx = {
    graphqlClient: new Client({
      url: `${url}/graphql`,
      exchanges: [fetchExchange],
      fetchOptions: { headers: { Authorization: 'Bearer test-auth' } },
    }),
  } as CustomBuildContext;
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
  await rm(directory, { recursive: true, force: true });
});

it('publishes a manual preview PNG through the artifact GraphQL and HTTP upload path', async () => {
  const payload = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF9sAAAAASUVORK5CYII=',
    'base64'
  );
  const filename = 'screenshot-2026-09-24T08-45-59-123Z-a1b2c3d4e5f6.png';
  await writeFile(path.join(directory, filename), payload);
  const bodies: Buffer[] = [];
  handle = (request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', chunk => chunks.push(Buffer.from(chunk)));
    request.on('end', () => {
      bodies.push(Buffer.concat(chunks));
      response.end();
    });
  };
  const session = loadScreenshotSessionAsync(ctx, 'drs-id', {
    warn: jest.fn(),
  } as unknown as bunyan);
  await uploadDeviceRunSessionScreenshotsAsync(ctx, {
    session,
    directory,
    deviceRunSessionId: 'drs-id',
    failedUploads: new Map(),
    logger: { info: jest.fn(), warn: jest.fn() } as unknown as bunyan,
    signal: new AbortController().signal,
  });
  expect(bodies).toEqual([payload]);
  expect(creates).toBe(1);
  expect(sessionLookups).toBe(1);
  expect(authorization).toBe('Bearer test-auth');
  expect(JSON.parse(creationBodies[0]).variables).toEqual(
    expect.objectContaining({
      deviceRunSessionId: 'drs-id',
      input: expect.objectContaining({
        name: 'Screenshot 2026-09-24 08:45:59 UTC',
        filename: 'my-app-ios-a1b2c3d-2026-09-24T08-45-59-123Z.png',
        kind: 'screenshot',
        size: payload.length,
        metadata: {
          __eas_type: 'screenshot',
          appSlug: 'my-app',
          platform: 'ios',
          buildId: 'installed-build',
          gitCommitHash: installedCommit,
        },
      }),
    })
  );
  await expect(stat(path.join(directory, filename))).rejects.toMatchObject({ code: 'ENOENT' });
});

it('rereads the PNG when the artifact PUT is retried', async () => {
  const filename = 'screenshot-2026-09-24T08-45-59-123Z-a1b2c3d4e5f6.png';
  await writeFile(path.join(directory, filename), 'retried-capture');
  const bodies: string[] = [];
  handle = (request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', chunk => (body += chunk));
    request.on('end', () => {
      bodies.push(body);
      response.statusCode = bodies.length === 1 ? 503 : 200;
      response.end();
    });
  };
  const uploaded = await uploadDeviceRunSessionScreenshotsAsync(ctx, {
    directory,
    deviceRunSessionId: 'drs-id',
    failedUploads: new Map(),
    logger: { info: jest.fn(), warn: jest.fn() } as unknown as bunyan,
    signal: new AbortController().signal,
  });
  expect(uploaded).toEqual({ uploaded: 1, saveFailures: 0 });
  expect(creates).toBe(1);
  expect(bodies).toEqual(['retried-capture', 'retried-capture']);
  await expect(stat(path.join(directory, filename))).rejects.toMatchObject({ code: 'ENOENT' });
});

it('aborts a stalled GraphQL upload request and retains the PNG', async () => {
  stallCreation = true;
  const filename = 'screenshot-2026-09-24T08-45-59-123Z-a1b2c3d4e5f6.png';
  await writeFile(path.join(directory, filename), 'png');
  const controller = new AbortController();
  const upload = uploadDeviceRunSessionScreenshotsAsync(ctx, {
    directory,
    deviceRunSessionId: 'drs-id',
    failedUploads: new Map(),
    logger: { info: jest.fn(), warn: jest.fn() } as unknown as bunyan,
    signal: controller.signal,
  });
  await creationStarted.promise;
  controller.abort();
  await upload;
  expect((await stat(path.join(directory, filename))).size).toBe(3);
});

it('keeps the signed upload URL out of the error when the upload connection drops', async () => {
  uploadQuery = '?X-Goog-Signature=secret-signature';
  handle = request => request.socket.destroy();
  const filename = 'screenshot-2026-09-24T08-45-59-123Z-a1b2c3d4e5f6.png';
  await writeFile(path.join(directory, filename), 'png');
  const failedUploads = new Map<string, { attempts: number; lastError: Error }>();
  const logger = { info: jest.fn(), warn: jest.fn() } as unknown as bunyan;
  await uploadDeviceRunSessionScreenshotsAsync(ctx, {
    directory,
    deviceRunSessionId: 'drs-id',
    failedUploads,
    logger,
    signal: new AbortController().signal,
  });
  const error = failedUploads.get(filename)?.lastError;
  expect(error?.message).toBe(
    `Failed to upload device run session artifact ${filename.slice(0, -4)}: ECONNRESET.`
  );
  expect(error?.cause).toBeUndefined();
  expect(JSON.stringify(jest.mocked(logger.warn).mock.calls)).not.toContain('secret-signature');
  expect(JSON.stringify(jest.mocked(logger.warn).mock.calls)).not.toContain('/artifact');
});

it('falls back without using the workflow commit when the session lookup fails', async () => {
  sessionLookupFails = true;
  ctx.metadata = { appName: 'wrong-app', gitCommitHash: 'f'.repeat(40) };
  const logger = { warn: jest.fn() } as unknown as bunyan;
  const session = await loadScreenshotSessionAsync(ctx, 'drs-id', logger);
  expect(session).toBeNull();
  expect(logger.warn).toHaveBeenCalledWith(
    expect.objectContaining({ deviceRunSessionId: 'drs-id' }),
    'Could not load screenshot session details; using capture timestamps.'
  );
});
