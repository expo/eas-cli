import nock from 'nock';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  api,
  editPath,
  mockToken,
  packageName,
  serviceAccount,
} from './fixtures/googlePlayTestUtils';
import { GooglePlayClient } from '../GooglePlayClient';
import { GooglePlayUtils } from '../GooglePlayUtils';

jest.unmock('node-fetch');
jest.unmock('fs');
jest.unmock('node:fs');
jest.unmock('fs/promises');
jest.unmock('node:fs/promises');
jest.mock('promise-retry', () => {
  const promiseRetry = jest.requireActual('promise-retry');
  return (fn: Parameters<typeof promiseRetry>[0], options: object) =>
    promiseRetry(fn, { ...options, minTimeout: 0, maxTimeout: 0 });
});

let directory: string;
let artifactPath: string;
let client: GooglePlayClient;
const session = '/upload/session';
const chunkSize = 8 * 1024 * 1024;
beforeEach(async () => {
  nock.disableNetConnect();
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'play-client-test-'));
  artifactPath = path.join(directory, 'binary');
  await fs.writeFile(artifactPath, Buffer.alloc(12));
  client = new GooglePlayClient(serviceAccount);
});
afterEach(async () => {
  const pending = nock.pendingMocks();
  nock.cleanAll();
  nock.enableNetConnect();
  jest.restoreAllMocks();
  await fs.rm(directory, { recursive: true, force: true });
  expect(pending).toEqual([]);
});
function mockStart(location = `https://androidpublisher.googleapis.com${session}`): void {
  api()
    .post(`/upload${editPath}/apks`)
    .query({ uploadType: 'resumable' })
    .reply(200, '', { Location: location });
}
function upload(signal?: AbortSignal, onProgress = jest.fn()) {
  return GooglePlayUtils.uploadApplicationAsync(client, {
    packageName,
    editId: 'edit',
    artifactPath,
    artifactType: 'apk',
    signal,
    onProgress,
  }).then(result => result.versionCode);
}
function uploadApi(): nock.Scope {
  return nock('https://androidpublisher.googleapis.com', { badheaders: ['authorization'] });
}

function status(total = 12): nock.Interceptor {
  return uploadApi()
    .put(session)
    .matchHeader('content-length', '0')
    .matchHeader('content-range', `bytes */${total}`);
}

it('uploads aligned chunks and reports server-confirmed progress', async () => {
  await fs.writeFile(artifactPath, Buffer.alloc(chunkSize + 12));
  mockToken();
  mockStart();
  uploadApi()
    .put(session)
    .matchHeader('content-length', String(chunkSize))
    .matchHeader('content-range', `bytes 0-${chunkSize - 1}/${chunkSize + 12}`)
    .reply(308, '', { Range: `bytes=0-${chunkSize - 1}` });
  uploadApi()
    .put(session)
    .matchHeader('content-length', '12')
    .matchHeader('content-range', `bytes ${chunkSize}-${chunkSize + 11}/${chunkSize + 12}`)
    .reply(200, { versionCode: 42 });
  const progress = jest.fn();
  await expect(upload(undefined, progress)).resolves.toBe(42);
  expect(progress.mock.calls).toEqual([
    [0, chunkSize + 12],
    [chunkSize, chunkSize + 12],
    [chunkSize + 12, chunkSize + 12],
  ]);
});

it.each(['network', 429, 503])(
  'recovers the accepted offset after a %s interruption',
  async failure => {
    mockToken();
    mockStart();
    const interrupted = uploadApi().put(session).matchHeader('content-range', 'bytes 0-11/12');
    if (failure === 'network') {
      interrupted.replyWithError('connection reset');
    } else {
      interrupted.reply(failure as number, { error: { message: 'retry' } });
    }
    status().reply(308, '', { Range: 'bytes=0-5' });
    uploadApi()
      .put(session)
      .matchHeader('content-range', 'bytes 6-11/12')
      .reply(200, { versionCode: 42 });
    const progress = jest.fn();
    await expect(upload(undefined, progress)).resolves.toBe(42);
    expect(progress.mock.calls).toEqual([
      [0, 12],
      [6, 12],
      [12, 12],
    ]);
  }
);

it('recovers a completed upload when the final upload response is lost', async () => {
  mockToken();
  mockStart();
  uploadApi()
    .put(session)
    .matchHeader('content-length', '12')
    .replyWithError('lost final response');
  status().reply(200, { versionCode: 42 });
  await expect(upload()).resolves.toBe(42);
});

it('recovers completion after a damaged response body without leaking the session URL', async () => {
  mockToken();
  mockStart();
  uploadApi().put(session).matchHeader('content-length', '12').reply(200, '{invalid JSON');
  status().reply(200, { versionCode: 42 });
  await expect(upload()).resolves.toBe(42);
});

it('sanitizes a malformed session URL', async () => {
  mockToken();
  mockStart('INVALID SECRET URL');
  const error = await upload().catch(error => error);
  expect(error).toBeInstanceOf(Error);
  expect(String(error)).toContain('invalid upload URL');
  expect(JSON.stringify(error)).not.toContain('SECRET');
});

it('retries status recovery after a transient Google error', async () => {
  mockToken();
  mockStart();
  uploadApi().put(session).matchHeader('content-length', '12').reply(503);
  status().reply(429);
  status().reply(308);
  uploadApi().put(session).matchHeader('content-length', '12').reply(200, { versionCode: 42 });
  await expect(upload()).resolves.toBe(42);
});

it.each([404, 410])('restarts an expired %s upload session within the same edit', async expired => {
  mockToken();
  mockStart();
  uploadApi().put(session).reply(expired);
  mockStart();
  uploadApi().put(session).reply(200, { versionCode: 42 });
  const progress = jest.fn();
  await expect(upload(undefined, progress)).resolves.toBe(42);
  expect(progress.mock.calls).toEqual([
    [0, 12],
    [0, 12],
    [12, 12],
  ]);
});

it('stops after the upload retry limit', async () => {
  mockToken();
  mockStart();
  uploadApi().put(session).matchHeader('content-length', '12').reply(503);
  status().times(5).reply(503);
  await expect(upload()).rejects.toThrow('HTTP 503');
});

it('stops after the upload session restart limit', async () => {
  mockToken();
  for (let i = 0; i < 3; i++) {
    mockStart();
    uploadApi().put(session).reply(410);
  }
  await expect(upload()).rejects.toThrow('HTTP 410');
});

it('cancels before upload and does not request credentials', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(upload(controller.signal)).rejects.toThrow();
});

it('cancels between chunks without sending the next chunk', async () => {
  await fs.writeFile(artifactPath, Buffer.alloc(chunkSize + 12));
  mockToken();
  mockStart();
  uploadApi()
    .put(session)
    .reply(308, '', { Range: `bytes=0-${chunkSize - 1}` });
  const controller = new AbortController();
  await expect(
    upload(
      controller.signal,
      jest.fn((bytes: number) => {
        if (bytes > 0) {
          controller.abort();
        }
      })
    )
  ).rejects.toThrow();
});

it.each([
  'https://attacker.example/upload?secret=signed',
  'http://androidpublisher.googleapis.com/upload',
  'https://androidpublisher.googleapis.com.attacker.example/upload',
  'https://user:password@androidpublisher.googleapis.com/upload',
])('rejects an unsafe session URL without leaking it: %s', async location => {
  mockToken();
  mockStart(location);
  await expect(upload()).rejects.toThrow('unsafe upload URL');
});

it('does not follow an upload redirect', async () => {
  mockToken();
  mockStart();
  uploadApi().put(session).reply(302, '', { Location: 'https://attacker.example/upload' });
  await expect(upload()).rejects.toThrow('HTTP 302');
});

it.each(['bytes=0-100', 'invalid', 'bytes=5-8'])(
  'rejects an invalid acknowledged range: %s',
  async range => {
    mockToken();
    mockStart();
    uploadApi().put(session).reply(308, '', { Range: range });
    await expect(upload()).rejects.toThrow('invalid upload range');
  }
);
