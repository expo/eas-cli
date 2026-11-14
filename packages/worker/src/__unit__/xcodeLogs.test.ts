import { RemoteLoggerStream, uploadWithSignedUrl } from '@expo/build-tools';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';
import zlib from 'zlib';

import config from '../config';
import { uploadXcodeBuildLogs } from '../ios/xcodeLogs';
import { createTextMaskingStream } from '../logger';

// These tests use real fs and directories in os.tmpdir(), since memfs read streams can't be closed.
jest.unmock('fs');
jest.unmock('node:fs');

const logger = { warn: jest.fn() } as any;

async function readAllAsync(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

describe(uploadXcodeBuildLogs, () => {
  const originalGcs = { ...config.loggers.gcs };
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xcode-logs-test-'));
    config.loggers.gcs.signedUploadUrlForXcodeBuildLogs = {
      url: 'https://gcs.expo.test/xcode-logs',
      headers: {},
    };
  });

  afterEach(async () => {
    Object.assign(config.loggers.gcs, originalGcs);
    jest.mocked(uploadWithSignedUrl).mockReset();
    await fs.remove(tmpDir);
  });

  it.each([
    ['no compression', null, (body: Buffer) => body],
    ['gzip', RemoteLoggerStream.CompressionMethod.GZIP, zlib.gunzipSync],
    ['brotli', RemoteLoggerStream.CompressionMethod.BR, zlib.brotliDecompressSync],
  ])('uploads the log with secrets masked (%s)', async (_name, compressionMethod, decompress) => {
    config.loggers.gcs.compressionMethod = compressionMethod as any;
    const logsPath = path.join(tmpDir, 'xcodebuild.log');
    await fs.writeFile(logsPath, '    export API_KEY\\=ab\\ cd\\=ef\\$gh\n** BUILD SUCCEEDED **\n');
    let uploaded: Buffer | undefined;
    jest.mocked(uploadWithSignedUrl).mockImplementation(async ({ srcGeneratorAsync }) => {
      uploaded = await readAllAsync((await srcGeneratorAsync()) as Readable);
      return 'https://gcs.expo.test/xcode-logs';
    });

    await uploadXcodeBuildLogs(logger, logsPath, () =>
      createTextMaskingStream(new Set(['ab cd=ef$gh']))
    );

    expect(decompress(uploaded!).toString()).toBe(
      `    export API_KEY\\=${'*'.repeat(14)}\n** BUILD SUCCEEDED **\n`
    );
  });

  it.each([
    ['no compression', null],
    ['gzip', RemoteLoggerStream.CompressionMethod.GZIP],
  ])('fails the upload when the log cannot be read (%s)', async (_name, compressionMethod) => {
    config.loggers.gcs.compressionMethod = compressionMethod as any;
    jest.mocked(uploadWithSignedUrl).mockImplementation(async ({ srcGeneratorAsync }) => {
      await readAllAsync((await srcGeneratorAsync()) as Readable);
      return 'https://gcs.expo.test/xcode-logs';
    });

    // A directory can be stat'ed but not read.
    await expect(
      uploadXcodeBuildLogs(logger, tmpDir, () => createTextMaskingStream(new Set(['secret'])))
    ).rejects.toThrow('EISDIR');
  });
});
