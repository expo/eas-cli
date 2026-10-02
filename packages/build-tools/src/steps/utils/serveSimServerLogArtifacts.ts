import { type bunyan } from '@expo/logger';
import { createReadStream } from 'node:fs';
import { rm } from 'node:fs/promises';

import { type CustomBuildContext } from '../../customBuildContext';
import { Sentry } from '../../sentry';
import { uploadDeviceRunSessionArtifactAsync } from './deviceRunSessionArtifacts';
import { type ServeSimServerLog, prepareServeSimServerLogAsync } from './serveSimServerLogs';

export async function uploadServeSimServerLogsAsync(
  ctx: CustomBuildContext,
  {
    deviceRunSessionId,
    logs,
    logger,
  }: {
    deviceRunSessionId: string;
    logs: ServeSimServerLog[];
    logger: bunyan;
  }
): Promise<void> {
  let part = 0;
  for (const log of logs) {
    let stream: ReturnType<typeof createReadStream> | undefined;
    try {
      const { filePath, size, truncated } = await prepareServeSimServerLogAsync(log);
      if (size > 0) {
        part++;
        const fileController = new AbortController();
        const openStream = () => {
          const source = createReadStream(filePath);
          source.on('error', err => fileController.abort(err));
          return source;
        };
        stream = openStream();
        await uploadDeviceRunSessionArtifactAsync(ctx, {
          deviceRunSessionId,
          artifactId: `serve-sim-server-log-${part}`,
          name: part === 1 ? 'serve-sim server logs' : `serve-sim server logs (part ${part})`,
          filename: 'serve-sim.log',
          kind: 'serve-sim-log',
          metadata: { __eas_type: 'serve-sim-log', source: 'stdout-stderr', part, truncated },
          size,
          stream,
          reopenStream: openStream,
          signal: AbortSignal.any([fileController.signal, AbortSignal.timeout(30_000)]),
        });
        logger.info(`Uploaded serve-sim server logs (${size} bytes).`);
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      Sentry.capture('Could not upload serve-sim server logs', error, { level: 'warning' });
      logger.warn(
        { err: error, logDirectory: log.directory },
        'Could not upload serve-sim server logs; any prepared redacted log was retained.'
      );
      continue;
    } finally {
      stream?.destroy();
      await rm(log.filePath, { force: true }).catch(err => {
        logger.warn(
          { err, filePath: log.filePath },
          'Could not remove the raw serve-sim server log.'
        );
      });
    }
    await rm(log.directory, { recursive: true, force: true }).catch(err => {
      logger.warn(
        { err, logDirectory: log.directory },
        'Could not remove serve-sim server log files.'
      );
    });
  }
}
