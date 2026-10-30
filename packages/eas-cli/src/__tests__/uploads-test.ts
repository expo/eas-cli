import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

import fs from 'fs-extra';
import nock from 'nock';

import { computeFileMd5Base64Async, uploadWithPresignedPostWithRetryAsync } from '../uploads';

describe(uploadWithPresignedPostWithRetryAsync, () => {
  const presignedPost = {
    url: 'https://storage.example.com/upload',
    fields: { key: 'object-key' },
  };
  let tmpDir: string;
  let file: string;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-cli-presigned-post-test-'));
    file = path.join(tmpDir, 'bundle.js');
    await fs.writeFile(file, 'abc');
  });

  afterAll(async () => {
    await fs.remove(tmpDir);
  });

  afterEach(() => {
    nock.cleanAll();
  });

  it('sends the policy fields and the file', async () => {
    let body = '';
    nock('https://storage.example.com')
      .post('/upload', requestBody => {
        body = requestBody;
        return true;
      })
      .reply(204);

    const response = await uploadWithPresignedPostWithRetryAsync(file, presignedPost, () => {});

    expect(response.status).toBe(204);
    expect(body).toContain('object-key');
    expect(body).toContain('filename="bundle.js"');
    expect(body).toContain('abc');
  });

  it('accepts the upload when Cloud Storage stored the same MD5', async () => {
    nock('https://storage.example.com')
      .post('/upload')
      .reply(204, '', { 'x-goog-hash': 'crc32c=AAAAAA==,md5=kAFQmDzST7DWlj99KOF/cg==' });

    const response = await uploadWithPresignedPostWithRetryAsync(file, presignedPost, () => {});

    expect(response.status).toBe(204);
  });

  it('retries and then fails when Cloud Storage stored a different MD5', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    try {
      nock('https://storage.example.com')
        .post('/upload')
        .times(4)
        .reply(204, '', { 'x-goog-hash': 'crc32c=AAAAAA==,md5=AAAAAAAAAAAAAAAAAAAAAA==' });
      const onAssetUploadBegin = jest.fn();

      const upload = uploadWithPresignedPostWithRetryAsync(file, presignedPost, onAssetUploadBegin);
      let settled = false;
      upload.catch(() => {}).finally(() => (settled = true));
      while (!settled) {
        await new Promise(resolve => setImmediate(resolve));
        jest.advanceTimersByTime(500);
      }

      await expect(upload).rejects.toThrow('does not match the local file');
      expect(onAssetUploadBegin).toHaveBeenCalledTimes(4);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe(computeFileMd5Base64Async, () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-cli-uploads-test-'));
  });

  afterAll(async () => {
    await fs.remove(tmpDir);
  });

  it('computes the base64 MD5 checksum of a small file', async () => {
    const file = path.join(tmpDir, 'small.txt');
    await fs.writeFile(file, 'abc');
    // md5("abc") = 900150983cd24fb0d6963f7d28e17f72
    expect(await computeFileMd5Base64Async(file)).toBe('kAFQmDzST7DWlj99KOF/cg==');
  });

  it('computes the same checksum as a one-shot hash for a file larger than one stream chunk', async () => {
    const file = path.join(tmpDir, 'large.bin');
    const data = Buffer.alloc(256 * 1024);
    for (let i = 0; i < data.length; i++) {
      data[i] = i % 251;
    }
    await fs.writeFile(file, data);
    const expected = crypto.createHash('md5').update(data).digest('base64');
    expect(await computeFileMd5Base64Async(file)).toBe(expected);
  });
});
