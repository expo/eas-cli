import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { Readable, pipeline } from 'stream';
import { promisify } from 'util';

import { v4 as uuid } from 'uuid';
import fs from 'fs-extra';
import { bunyan } from '@expo/logger';
import GCS from '@expo/gcs';

import config from '../config';

export async function uploadXcodeBuildLogs(logger: bunyan, logsPath: string): Promise<void> {
  if (!config.loggers.gcs.signedUploadUrlForXcodeBuildLogs) {
    logger.warn('GCS Presigned URL for Xcode logs was not specified, skipping upload');
  } else {
    await GCS.uploadWithSignedUrl({
      signedUrl: config.loggers.gcs.signedUploadUrlForXcodeBuildLogs,
      srcGeneratorAsync: async () => {
        const stat = await fs.stat(logsPath);
        return await compress(
          { stream: fs.createReadStream(logsPath), length: stat.size },
          config.loggers.gcs.compressionMethod
        );
      },
    });
  }
}

// HACK(Mike): Copypasta of a fragment of functionality from GCSLoggerStream.
async function compress(
  src: { stream: Readable; length: number },
  method: 'gzip' | 'br' | null
): Promise<{ stream: Readable }> {
  const encoder =
    method === 'gzip' ? zlib.createGzip() : method === 'br' ? zlib.createBrotliCompress() : null;

  if (!encoder) {
    return src;
  }

  const fname = path.join(os.tmpdir(), `logs-${uuid()}.compressed`);
  const pipe = promisify(pipeline);
  const dst = fs.createWriteStream(fname);

  await pipe(src.stream, encoder, dst);
  const { size } = await fs.stat(fname);
  return {
    stream: fs.createReadStream(fname, { end: size }),
  };
}
