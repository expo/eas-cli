import {
  fetchWebPreviewTurnArgsAsync,
  selectXcodeDeveloperDirectoryAsync,
} from '../../steps/utils/remoteDeviceRunSession';
import { type SessionTask } from '../runtime';

export const FETCH_TURN_CREDENTIALS_TASK_ID = 'fetch_turn_credentials';
export const SELECT_XCODE_TASK_ID = 'select_xcode';

/** Fetches Cloudflare TURN credentials for the web preview. Best effort: the preview falls back to P2P/STUN. */
export function createFetchTurnCredentialsTask(): SessionTask {
  return {
    id: FETCH_TURN_CREDENTIALS_TASK_ID,
    displayName: 'Fetch TURN credentials',
    onFailure: 'warn',
    run: async ({ runtime, logger }) => {
      runtime.state.turnArgs = await fetchWebPreviewTurnArgsAsync(runtime.ctx, {
        env: runtime.env,
        logger,
        deviceRunSessionId: runtime.deviceRunSessionId,
      });
    },
  };
}

/** Selects the Xcode every session tool uses, before the device boots under it. macOS only. */
export function createSelectXcodeTask(): SessionTask {
  return {
    id: SELECT_XCODE_TASK_ID,
    displayName: 'Select Xcode',
    onFailure: 'fail-session',
    run: async ({ runtime, logger }) => {
      await selectXcodeDeveloperDirectoryAsync({ env: runtime.env, logger });
    },
  };
}
