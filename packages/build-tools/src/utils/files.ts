// import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import stream from 'node:stream';
import { promisify } from 'node:util';

import * as tar from 'tar';

const streamPipeline = promisify(stream.pipeline);

export async function decompressTarAsync({
  archivePath,
  destinationDirectory,
}: {
  archivePath: string;
  destinationDirectory: string;
}): Promise<void> {
  const fileHandle = await fsPromises.open(archivePath, 'r');
  await streamPipeline(
    fileHandle.createReadStream(),
    tar.extract({ cwd: destinationDirectory }, [])
  );
}

export async function isFileTarGzAsync(path: string): Promise<boolean> {
  if (path.endsWith('tar.gz') || path.endsWith('.tgz')) {
    return true;
  }

  // read only first 3 bytes to check if it's gzip
  const fd = await fsPromises.open(path, 'r');
  const { buffer } = await fd.read(Buffer.alloc(3), 0, 3, 0);
  await fd.close();

  if (buffer.length < 3) {
    return false;
  }

  // Check whether provided `buffer` is a valid Gzip file header
  // Gzip files always begin with 0x1F 0x8B 0x08 magic bytes
  // Source: https://en.wikipedia.org/wiki/Gzip#File_format
  return buffer[0] === 0x1f && buffer[1] === 0x8b && buffer[2] === 0x08;
}
