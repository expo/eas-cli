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
  const contents = Array.from({ length: 50000 }, (_, i) => `line ${i}\n`).join('');
  let tmpDir: string;
  let file: string;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-cli-presigned-post-test-'));
    file = path.join(tmpDir, 'bundle.js');
    await fs.writeFile(file, contents);
  });

  afterAll(async () => {
    await fs.remove(tmpDir);
  });

  afterEach(() => {
    nock.cleanAll();
  });

  it('sends the whole file and reports activity while it uploads', async () => {
    let body = '';
    nock('https://storage.example.com')
      .post('/upload', requestBody => {
        body = requestBody;
        return true;
      })
      .reply(204);
    const onAssetUploadBegin = jest.fn();

    await uploadWithPresignedPostWithRetryAsync(file, presignedPost, onAssetUploadBegin);

    expect(body).toContain('filename="bundle.js"');
    expect(body).toContain(contents);
    expect(onAssetUploadBegin.mock.calls.length).toBeGreaterThan(2);
    expect(onAssetUploadBegin).toHaveBeenCalledWith(
      expect.objectContaining({ file, fileSize: contents.length, uploadedBytes: 0 })
    );
    expect(onAssetUploadBegin).toHaveBeenLastCalledWith(
      expect.objectContaining({ file, fileSize: contents.length, uploadedBytes: contents.length })
    );
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
