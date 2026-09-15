import { startLocalEgressAsync } from '../../steps/functions/startLocalEgress';
import { getNgrokAuthtokenOrThrow } from '../../steps/utils/remoteDeviceRunSession';
import { type SessionTask } from '../runtime';

export const START_LOCAL_EGRESS_TASK_ID = 'start_local_egress';

/**
 * Points the host's system proxy at the EAS CLI egress client before the device
 * boots, so the Simulator reads it at boot. The runner releases the resources in
 * its teardown. macOS only.
 */
export function createStartLocalEgressTask(): SessionTask {
  return {
    id: START_LOCAL_EGRESS_TASK_ID,
    displayName: 'Start local egress',
    onFailure: 'fail-session',
    run: async ({ runtime, logger, signal }) => {
      await startLocalEgressAsync({
        ngrokTunnelDomain: runtime.session.ngrokTunnelDomain,
        ngrokAuthtoken: getNgrokAuthtokenOrThrow(runtime.env),
        env: runtime.env,
        logger,
        signal,
      });
    },
  };
}
