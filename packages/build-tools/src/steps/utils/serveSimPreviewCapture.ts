import { randomUUID } from 'node:crypto';
import { copyFile, rm } from 'node:fs/promises';
import path from 'node:path';

import { runServeSimActionWithResultAsync } from './serveSimActions';

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
  const action = (name: string, params: Record<string, unknown>, signal?: AbortSignal) =>
    runServeSimActionWithResultAsync({
      port,
      token,
      action: name,
      params,
      timeoutMs: 30_000,
      signal,
    });
  return {
    async prepareAsync(signal: AbortSignal): Promise<void> {
      const catalog = JSON.parse(await action('actions.describe', {}, signal));
      const properties = catalog?.['screenshot.capture']?.properties;
      if (
        properties?.copyToDesktop?.type !== 'boolean' ||
        properties?.automation?.type !== 'boolean'
      ) {
        throw new Error('This serve-sim version does not support session preview captures.');
      }
    },
    async captureAsync(destination: string, signal: AbortSignal): Promise<void> {
      signal.throwIfAborted();
      const fileName = `serve-sim-screenshot-preview-${randomUUID()}.png`;
      const staged = path.join(tmpdir, 'serve-sim-screenshots', fileName);
      ownedFiles.add(staged);
      // Closing exec-ws does not cancel its host action. Drain a sent capture before honoring
      // cancellation; on timeout/disconnect, leave its file alone until the host has stopped.
      await runServeSimActionWithResultAsync({
        port,
        token,
        action: 'screenshot.capture',
        params: { udid: device, fileName, copyToDesktop: false, automation: true },
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
