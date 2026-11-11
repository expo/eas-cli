import { randomUUID } from 'node:crypto';
import { copyFile, rm } from 'node:fs/promises';
import path from 'node:path';

import { runServeSimActionAsync, runServeSimActionWithResultAsync } from './serveSimActions';

export function createServeSimPreviewCapture({
  port,
  token,
  device,
  tmpdir,
}: {
  port: number;
  token: string;
  device: string;
  tmpdir: string;
}) {
  const ownedFiles = new Set<string>();
  return {
    async isSupportedAsync(signal: AbortSignal): Promise<boolean> {
      const result = await runServeSimActionWithResultAsync({
        port,
        token,
        action: 'actions.describe',
        params: {},
        timeoutMs: 30_000,
        signal,
      });
      const catalog: {
        'screenshot.capture'?: { properties?: { automation?: { type?: unknown } } };
      } | null = JSON.parse(result);
      return catalog?.['screenshot.capture']?.properties?.automation?.type === 'boolean';
    },
    async captureAsync(destination: string, signal: AbortSignal): Promise<void> {
      signal.throwIfAborted();
      const fileName = `serve-sim-screenshot-preview-${randomUUID()}.png`;
      const staged = path.join(tmpdir, 'serve-sim-screenshots', fileName);
      ownedFiles.add(staged);
      // Closing exec-ws does not cancel its host action. Drain a sent capture before honoring
      // cancellation; on timeout/disconnect, leave its file alone until the host has stopped.
      await runServeSimActionAsync({
        port,
        token,
        action: 'screenshot.capture',
        params: { udid: device, fileName, automation: true },
        timeoutMs: 30_000,
        signal,
        drainAfterDispatch: true,
      });
      try {
        signal.throwIfAborted();
        await copyFile(staged, destination);
      } finally {
        await rm(staged, { force: true });
        ownedFiles.delete(staged);
      }
    },
    /** Call only after the host process group has stopped, including timed-out actions. */
    async cleanupAfterHostStoppedAsync(): Promise<void> {
      const results = await Promise.allSettled(
        [...ownedFiles].map(async file => {
          await rm(file, { force: true });
          ownedFiles.delete(file);
        })
      );
      const errors = results
        .filter(result => result.status === 'rejected')
        .map(result => result.reason);
      if (errors.length) {
        throw new AggregateError(errors, 'Could not remove preview captures.');
      }
    },
  };
}
