import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import * as tar from 'tar';

export async function decompressTarAsync({
  archivePath,
  destinationDirectory,
  signal,
}: {
  archivePath: string;
  destinationDirectory: string;
  /** Stops the extraction when aborted; the promise then rejects with the abort reason. */
  signal?: AbortSignal;
}): Promise<void> {
  if (!signal) {
    await tar.extract({
      file: archivePath,
      cwd: destinationDirectory,
    });
    return;
  }

  signal.throwIfAborted();
  // tar.extract({ file }) cannot be stopped, so feed the file to an Unpack that can be.
  const unpack = new tar.Unpack({ cwd: destinationDirectory });
  const source = fs.createReadStream(archivePath);
  const onAbort = (): void => {
    source.destroy();
    unpack.abort(
      signal.reason instanceof Error ? signal.reason : new Error('The extraction was aborted.')
    );
  };
  try {
    await new Promise<void>((resolve, reject) => {
      unpack.on('error', reject);
      unpack.on('close', () => resolve());
      source.on('error', reject);
      signal.addEventListener('abort', onAbort, { once: true });
      source.pipe(unpack);
    });
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

export async function isFileTarGzAsync(path: string): Promise<boolean> {
  if (path.endsWith('tar.gz') || path.endsWith('.tgz')) {
    return true;
  }

  // read only first 3 bytes to check if it's gzip
  const fd = await fsPromises.open(path, 'r');
  const buffer = new Uint8Array(3);
  await fd.read(buffer, 0, 3, 0);
  await fd.close();

  if (buffer.length < 3) {
    return false;
  }

  // Check whether provided `buffer` is a valid Gzip file header
  // Gzip files always begin with 0x1F 0x8B 0x08 magic bytes
  // Source: https://en.wikipedia.org/wiki/Gzip#File_format
  return buffer[0] === 0x1f && buffer[1] === 0x8b && buffer[2] === 0x08;
}
