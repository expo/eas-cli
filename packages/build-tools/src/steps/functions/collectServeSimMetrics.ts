import { BuildFunction, BuildRuntimePlatform } from '@expo/steps';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';

import { type CustomBuildContext } from '../../customBuildContext';
import { Sentry } from '../../sentry';
import { getDeviceRunSessionIdOrThrow } from '../utils/remoteDeviceRunSession';
import { uploadServeSimMetricsFileAsync } from '../utils/serveSimMetricsArtifacts';
import { ServeSimMetricsRecorder } from '../utils/serveSimMetricsRecorder';
import { finishGuestMetricsAsync } from '../utils/guestMetricsRecorder';
import { uploadDeviceRunSessionArtifactAsync } from '../utils/deviceRunSessionArtifacts';

export function createCollectServeSimMetricsBuildFunction(ctx: CustomBuildContext): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'collect_serve_sim_metrics',
    name: 'Collect serve-sim metrics',
    __metricsId: 'eas/collect_serve_sim_metrics',
    supportedRuntimePlatforms: [BuildRuntimePlatform.DARWIN],
    fn: async ({ logger }, { env }) => {
      try {
        const filePath = await finishGuestMetricsAsync();
        if (filePath) {
          await uploadDeviceRunSessionArtifactAsync(ctx, {
            deviceRunSessionId: getDeviceRunSessionIdOrThrow(env),
            artifactId: 'guest-metrics',
            name: 'Guest resource metrics',
            filename: 'guest-metrics.ndjson',
            kind: undefined,
            metadata: { schemaVersion: 1, scope: 'guest' },
            size: (await stat(filePath)).size,
            openStream: () => createReadStream(filePath),
          });
        }
      } catch (err) {
        logger.warn({ err }, 'Could not collect guest metrics.');
      }
      const collected = await ServeSimMetricsRecorder.finishAsync({ logger });
      if (collected.length === 0) {
        logger.info('No serve-sim metrics collected; skipping upload.');
        return;
      }
      try {
        const deviceRunSessionId = getDeviceRunSessionIdOrThrow(env);
        for (const { udid, filePath, metadata } of collected) {
          await uploadServeSimMetricsFileAsync(ctx, {
            deviceRunSessionId,
            udid,
            filePath,
            metadata,
            logger,
          });
        }
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        Sentry.capture('Could not upload serve-sim metrics', error);
        logger.warn({ err: error }, 'Could not upload serve-sim metrics.');
      }
    },
  });
}
