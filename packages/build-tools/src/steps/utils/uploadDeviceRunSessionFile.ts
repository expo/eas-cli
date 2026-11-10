import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';

import { type CustomBuildContext } from '../../customBuildContext';
import {
  type ArtifactMetadata,
  uploadDeviceRunSessionArtifactAsync,
} from './deviceRunSessionArtifacts';

/** Upload a finalized file, reopening it for each attempt. */
export async function uploadDeviceRunSessionFileAsync(
  ctx: CustomBuildContext,
  {
    filePath,
    describe,
    signal,
    attempts = 1,
  }: {
    filePath: string;
    describe: (size: number) => Omit<ArtifactMetadata, 'size'>;
    signal?: AbortSignal;
    attempts?: number;
  }
): Promise<boolean> {
  const { size } = await stat(filePath);
  if (size === 0) {
    return false;
  }
  const readController = new AbortController();
  await uploadDeviceRunSessionArtifactAsync(ctx, {
    ...describe(size),
    size,
    openStream: () =>
      createReadStream(filePath).on('error', err => {
        // An HTTP error aborts one request body, not the remaining upload attempts.
        if (err.name !== 'AbortError') {
          readController.abort(err);
        }
      }),
    signal: AbortSignal.any([readController.signal, ...(signal ? [signal] : [])]),
    attempts,
  });
  return true;
}
