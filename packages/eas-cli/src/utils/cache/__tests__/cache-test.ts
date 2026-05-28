import fs from 'fs';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';

import { Response } from '../../../fetch';
import { FileSystemResponseCache } from '../FileSystemResponseCache';
import {
  getRequestCacheKey,
  getRequestInfoCacheData,
  type ResponseCacheEntry,
} from '../ResponseCache';
import { wrapFetchWithCache } from '../wrapFetchWithCache';

function bufferStream(buf: Buffer): Readable {
  return new Readable({
    read() {
      this.push(buf);
      this.push(null);
    },
  });
}

function makeEntry(body: Buffer | string): ResponseCacheEntry {
  const buf = typeof body === 'string' ? Buffer.from(body) : body;
  return {
    body:
      buf.length === 0
        ? new Readable({
            read() {
              this.push(null);
            },
          })
        : bufferStream(buf),
    info: {
      url: 'https://example.com/file.bin',
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/octet-stream' },
    },
  };
}

async function readToString(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString();
}

describe('getRequestInfoCacheData', () => {
  it('returns the url for a string', () => {
    expect(getRequestInfoCacheData('https://example.com/x')).toEqual({
      url: 'https://example.com/x',
    });
  });

  it('reads `href` from a URLLike', () => {
    expect(getRequestInfoCacheData(new URL('https://example.com/x'))).toEqual({
      url: 'https://example.com/x',
    });
  });

  it('hashes identical strings to identical keys', () => {
    expect(getRequestCacheKey('https://example.com/x')).toEqual(
      getRequestCacheKey('https://example.com/x')
    );
  });

  it('hashes different strings to different keys', () => {
    expect(getRequestCacheKey('https://example.com/x')).not.toEqual(
      getRequestCacheKey('https://example.com/y')
    );
  });
});

describe('FileSystemResponseCache', () => {
  let cacheDir: string;

  beforeEach(() => {
    cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eas-cli-cache-test-'));
  });

  afterEach(() => {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  });

  it('round-trips a response body through the cache', async () => {
    const cache = new FileSystemResponseCache({ cacheDirectory: cacheDir });
    await cache.set('key', makeEntry('hello cache'));

    const entry = await cache.get('key');
    expect(entry).toBeDefined();
    expect(await readToString(entry!.body)).toBe('hello cache');
    expect(entry!.info.status).toBe(200);
    expect(entry!.info.headers['content-type']).toBe('application/octet-stream');
  });

  it('returns undefined and removes the entry after the TTL elapses', async () => {
    const cache = new FileSystemResponseCache({ cacheDirectory: cacheDir, ttl: 1 });
    await cache.set('key', makeEntry('temp'));

    await new Promise(resolve => setTimeout(resolve, 5));
    expect(await cache.get('key')).toBeUndefined();
    // The expired entry's info file should have been removed by the get() call.
    expect(fs.readdirSync(cacheDir)).toHaveLength(0);
  });

  it('marks zero-byte responses as empty', async () => {
    const cache = new FileSystemResponseCache({ cacheDirectory: cacheDir });
    await cache.set('empty', makeEntry(Buffer.alloc(0)));
    const entry = await cache.get('empty');
    expect(entry).toBeDefined();
    expect(await readToString(entry!.body)).toBe('');
  });
});

describe('wrapFetchWithCache', () => {
  let cacheDir: string;

  beforeEach(() => {
    cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eas-cli-cache-test-'));
  });

  afterEach(() => {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  });

  it('hits the underlying fetch once, then serves repeat calls from cache', async () => {
    const cache = new FileSystemResponseCache({ cacheDirectory: cacheDir });
    const upstream = jest.fn(
      async () => new Response(bufferStream(Buffer.from('payload')), { status: 200 })
    );
    const cachedFetch = wrapFetchWithCache(upstream, cache);

    const first = await cachedFetch('https://example.com/x');
    expect(await readToString(first.body)).toBe('payload');

    const second = await cachedFetch('https://example.com/x');
    expect(await readToString(second.body)).toBe('payload');
    expect(upstream).toHaveBeenCalledTimes(1);
  });
});
