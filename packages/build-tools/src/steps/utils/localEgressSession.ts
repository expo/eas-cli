import { type BuildFunction, type BuildStepEnv } from '@expo/steps';

import {
  buildEgressRemoteConfigFields,
  monitorLocalEgressAsync,
  readLocalEgressHandoffAsync,
  stopLocalEgressResourcesAsync,
} from './localEgress';
import { rebindLocalEgressGuardRelays } from './localEgressGuard';
import { uploadRemoteSessionConfigAsync } from './remoteDeviceRunSession';

/** Release the pre-boot egress resources even if controller startup or teardown fails. */
export function withLocalEgressSession(
  fn: NonNullable<BuildFunction['fn']>
): NonNullable<BuildFunction['fn']> {
  return async (context, args) => {
    try {
      args.signal?.throwIfAborted();
      await fn(context, args);
    } finally {
      await stopLocalEgressResourcesAsync(context.logger);
    }
  };
}

/** All simulator controllers publish the same egress handoff and run the same monitor. */
export async function uploadRemoteSessionConfigWithLocalEgressAsync({
  env,
  signal,
  ...options
}: Parameters<typeof uploadRemoteSessionConfigAsync>[0] & {
  env: BuildStepEnv;
  signal?: AbortSignal;
}): Promise<void> {
  // Written by start_local_egress before simulator boot; absent for ordinary sessions.
  const localEgress = await readLocalEgressHandoffAsync();
  signal?.throwIfAborted();
  await uploadRemoteSessionConfigAsync({
    ...options,
    remoteConfig: { ...options.remoteConfig, ...buildEgressRemoteConfigFields(localEgress) },
  });
  if (localEgress && !signal?.aborted) {
    // Guard refusals from here on show up under this step in the job log,
    // alongside the monitor's reports, instead of under the boot step.
    rebindLocalEgressGuardRelays(options.logger);
    options.logger.info(
      'Local egress: waiting for the EAS CLI egress client to connect. Proxied HTTP(S) ' +
        'requests are unavailable until it does.'
    );
    // The monitor also observes the registered resources' lifetime signal, which
    // withLocalEgressSession aborts on success, failure, or cancellation.
    void monitorLocalEgressAsync({
      port: localEgress.port,
      env,
      logger: options.logger,
      signal: signal ?? new AbortController().signal,
    });
  }
}
