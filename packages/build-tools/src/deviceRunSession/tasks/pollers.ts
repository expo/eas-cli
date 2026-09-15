import { collectAndUploadServeSimMetricsAsync } from '../../steps/functions/collectServeSimMetrics';
import { uploadIosSimulatorRecordingsAsync } from '../../steps/functions/uploadDeviceRunSessionScreenRecordings';
import { IosSimulatorRecordingUtils } from '../../steps/utils/IosSimulatorRecordingUtils';
import { ServeSimMetricsRecorder } from '../../steps/utils/serveSimMetricsRecorder';
import { type SessionTask } from '../runtime';

export const START_POLLERS_TASK_ID = 'start_pollers';

/**
 * Starts the screen recording and serve-sim metrics pollers. Both poll for booted
 * devices, so they can start before the boot. Their results are uploaded in the
 * teardown. macOS only.
 */
export function createStartPollersTask({ needs }: { needs: readonly string[] }): SessionTask {
  return {
    id: START_POLLERS_TASK_ID,
    displayName: 'Start screen recording and metrics collection',
    needs,
    onFailure: 'warn',
    run: async ({ runtime, logger }) => {
      const { deviceRunSessionId, ctx } = runtime;

      await IosSimulatorRecordingUtils.startAsync({ env: runtime.env, logger });
      runtime.teardown.push('screen recordings', async teardownLogger => {
        const recordings = await IosSimulatorRecordingUtils.finishAsync({ logger: teardownLogger });
        await uploadIosSimulatorRecordingsAsync(ctx, {
          deviceRunSessionId,
          recordings,
          logger: teardownLogger,
        });
      });

      await ServeSimMetricsRecorder.startAsync({ logger });
      runtime.teardown.push('serve-sim metrics', async teardownLogger => {
        await collectAndUploadServeSimMetricsAsync(ctx, {
          deviceRunSessionId,
          logger: teardownLogger,
        });
      });
    },
  };
}
