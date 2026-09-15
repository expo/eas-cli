import { waitForDeviceRunSessionStoppedAsync } from '../../steps/utils/remoteDeviceRunSession';
import { type SessionTask } from '../runtime';

export const HOLD_SESSION_TASK_ID = 'hold_session';

/**
 * Keeps the job alive until the session is stopped by a client, reaches its
 * maximum duration, or idles past its idle timeout. The idle timeout only
 * applies to sessions with a controller, which is where activity is observed.
 */
export function createHoldSessionTask({ needs }: { needs: readonly string[] }): SessionTask {
  return {
    id: HOLD_SESSION_TASK_ID,
    displayName: 'Session',
    needs,
    onFailure: 'fail-session',
    run: async ({ runtime, logger, signal }) => {
      const { session } = runtime;
      const { controller } = runtime.state;
      await waitForDeviceRunSessionStoppedAsync({
        ctx: runtime.ctx,
        deviceRunSessionId: runtime.deviceRunSessionId,
        logger,
        maxDurationSeconds: session.maxDurationSeconds,
        signal,
        idleTimeout:
          controller && session.maxIdleTimeMinutes !== undefined
            ? {
                maxIdleTimeMinutes: session.maxIdleTimeMinutes,
                getLastEventObservedAt: controller.getLastEventObservedAt,
              }
            : undefined,
      });
    },
  };
}
