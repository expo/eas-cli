import { SystemError } from '@expo/eas-build-job';
import { sleepAsync } from '../../utils/retry';
import { type DetachedProcessHandle, isProcessRunning } from './remoteDeviceRunSession';
import { readServeSimServersAsync } from './serveSimMetricsRecorder';

export async function waitForServeSimControlAsync({
  device,
  port,
  stateDir,
  previewServer,
  timeoutMs,
  signal,
}: {
  device: string;
  port: number;
  stateDir: string;
  previewServer: DetachedProcessHandle;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    if (
      previewServer.getExitError() !== undefined ||
      (previewServer.pid !== undefined && !isProcessRunning(previewServer.pid))
    ) {
      throw new SystemError(
        `serve-sim exited before its control API became ready. ${previewServer.getOutput()}`
      );
    }
    const servers = await readServeSimServersAsync(stateDir);
    const server = servers.find(
      server =>
        server.udid.toLowerCase() === device.toLowerCase() &&
        server.url === `http://127.0.0.1:${port}`
    );
    if (server?.token) {
      return server.token;
    }
    await sleepAsync(250);
  }
  signal?.throwIfAborted();
  throw new SystemError('Timed out waiting for serve-sim control readiness.');
}
