import { uploadWithSignedUrl } from '@expo/build-tools';
import { bunyan } from '@expo/logger';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { Readable, Transform, pipeline } from 'stream';
import { promisify } from 'util';
import { v4 as uuid } from 'uuid';
import zlib from 'zlib';

import config from '../config';

export async function uploadXcodeBuildLogs(
  logger: bunyan,
  logsPath: string,
  createLogMaskingStream: () => Transform
): Promise<void> {
  if (!config.loggers.gcs.signedUploadUrlForXcodeBuildLogs) {
    logger.warn('GCS Presigned URL for Xcode logs was not specified, skipping upload');
  } else {
    await uploadWithSignedUrl({
      signedUrl: config.loggers.gcs.signedUploadUrlForXcodeBuildLogs,
      srcGeneratorAsync: async () => {
        const stat = await fs.stat(logsPath);
        // Masking replaces each byte of a secret with one byte, so the size stays the same.
        // pipeline passes read errors on to the masked stream, which fails the upload.
        const maskedStream = pipeline(
          fs.createReadStream(logsPath),
          createLogMaskingStream(),
          () => {}
        );
        const { stream } = await compress(
          { stream: maskedStream, length: stat.size },
          config.loggers.gcs.compressionMethod
        );
        return stream;
      },
    });
  }
}

// HACK(Mike): Copypasta of a fragment of functionality from RemoteLoggerStream.
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
