import nullthrows from 'nullthrows';

import { Datadog } from '../../datadog';
import { uploadRemoteSessionConfigWithLocalEgressAsync } from '../../steps/utils/localEgressSession';
import { type SessionTask } from '../runtime';

export const PUBLISH_REMOTE_CONFIG_TASK_ID = 'publish_remote_config';

/**
 * Reports the remote session to the API server, which marks the session as in
 * progress. Runs once the preview and controller are up and, when an application
 * was requested, once its launch has finished with any outcome, so today's
 * "ready" meaning is unchanged: the app is launched when clients get access.
 */
export function createPublishRemoteConfigTask({
  needs,
  after,
}: {
  needs: readonly string[];
  after: readonly string[];
}): SessionTask {
  return {
    id: PUBLISH_REMOTE_CONFIG_TASK_ID,
    displayName: 'Publish remote session',
    needs,
    after,
    onFailure: 'fail-session',
    run: async ({ runtime, logger, signal }) => {
      const preview = nullthrows(runtime.state.preview, 'The web preview is not running.');
      const { controller } = runtime.state;
      const remoteConfig = controller
        ? {
            ...controller.remoteConfig,
            webPreviewUrl: preview.previewUrl,
            ...(preview.previewToken ? { webPreviewToken: preview.previewToken } : {}),
          }
        : {
            // The API server reads previewUrl and previewToken for web-preview-only sessions.
            previewUrl: preview.previewUrl,
            ...(preview.previewToken ? { previewToken: preview.previewToken } : {}),
          };

      await uploadRemoteSessionConfigWithLocalEgressAsync({
        env: runtime.env,
        signal,
        ctx: runtime.ctx,
        deviceRunSessionId: runtime.deviceRunSessionId,
        remoteConfig,
        logger,
      });
      runtime.state.remoteConfigPublishedAt = new Date();
      Datadog.distribution(
        'device_run_session.time_to_remote_config_ms',
        Date.now() - runtime.startedAt,
        runtime.metricTags()
      );
    },
  };
}
