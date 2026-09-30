import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

import fs from 'fs-extra';

import { computeFileMd5Base64Async } from '../uploads';

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
