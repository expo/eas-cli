import { type bunyan } from '@expo/logger';
import { BuildFunction, BuildRuntimePlatform } from '@expo/steps';

import { type CustomBuildContext } from '../../customBuildContext';
import { Sentry } from '../../sentry';
import { getDeviceRunSessionIdOrThrow } from '../utils/remoteDeviceRunSession';
import { uploadServeSimMetricsFileAsync } from '../utils/serveSimMetricsArtifacts';
import { ServeSimMetricsRecorder } from '../utils/serveSimMetricsRecorder';

export function createCollectServeSimMetricsBuildFunction(ctx: CustomBuildContext): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'collect_serve_sim_metrics',
    name: 'Collect serve-sim metrics',
    __metricsId: 'eas/collect_serve_sim_metrics',
    supportedRuntimePlatforms: [BuildRuntimePlatform.DARWIN],
    fn: async ({ logger }, { env }) => {
      const collected = await ServeSimMetricsRecorder.finishAsync({ logger });
      if (collected.length === 0) {
        logger.info('No serve-sim metrics collected; skipping upload.');
        return;
      }
      try {
        const deviceRunSessionId = getDeviceRunSessionIdOrThrow(env);
        await uploadCollectedServeSimMetricsAsync(ctx, { deviceRunSessionId, collected, logger });
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        Sentry.capture('Could not upload serve-sim metrics', error);
        logger.warn({ err: error }, 'Could not upload serve-sim metrics.');
      }
    },
  });
}

type CollectedServeSimMetrics = Awaited<ReturnType<typeof ServeSimMetricsRecorder.finishAsync>>;

async function uploadCollectedServeSimMetricsAsync(
  ctx: CustomBuildContext,
  {
    deviceRunSessionId,
    collected,
    logger,
  }: { deviceRunSessionId: string; collected: CollectedServeSimMetrics; logger: bunyan }
): Promise<void> {
  for (const { udid, filePath, metadata } of collected) {
    await uploadServeSimMetricsFileAsync(ctx, {
      deviceRunSessionId,
      udid,
      filePath,
      metadata,
      logger,
    });
  }
}

/**
 * Stops serve-sim metrics polling and uploads whatever was collected. Upload
 * failures are reported and logged; they never fail the session. Shared by the
 * `eas/collect_serve_sim_metrics` step and the device run session runner.
 */
export async function collectAndUploadServeSimMetricsAsync(
  ctx: CustomBuildContext,
  { deviceRunSessionId, logger }: { deviceRunSessionId: string; logger: bunyan }
): Promise<void> {
  const collected = await ServeSimMetricsRecorder.finishAsync({ logger });
  if (collected.length === 0) {
    logger.info('No serve-sim metrics collected; skipping upload.');
    return;
  }
  try {
    await uploadCollectedServeSimMetricsAsync(ctx, { deviceRunSessionId, collected, logger });
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    Sentry.capture('Could not upload serve-sim metrics', error);
    logger.warn({ err: error }, 'Could not upload serve-sim metrics.');
  }
}
