import { SystemError } from '@expo/eas-build-job';
import { BuildFunction, BuildRuntimePlatform } from '@expo/steps';
import spawn from '@expo/turtle-spawn';

import { CustomBuildContext } from '../../customBuildContext';
import { sleepAsync } from '../../utils/retry';
import {
  DetachedProcessHandle,
  ensureBrewPackageInstalledAsync,
  getDeviceRunSessionIdOrThrow,
  spawnDetached,
  uploadRemoteSessionConfigAsync,
} from '../utils/remoteDeviceRunSession';

const XCODE_DEVELOPER_DIR = '/Applications/Xcode.app/Contents/Developer';
const STARTUP_TIMEOUT_MS = 60_000;
const TRYCLOUDFLARE_URL_PATTERN = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;

export function createStartServeSimRemoteSessionBuildFunction(
  ctx: CustomBuildContext
): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'start_serve_sim_remote_session',
    name: 'Start serve-sim remote session',
    __metricsId: 'eas/start_serve_sim_remote_session',
    supportedRuntimePlatforms: [BuildRuntimePlatform.DARWIN],
    fn: async ({ logger }, { env }) => {
      const deviceRunSessionId = getDeviceRunSessionIdOrThrow(env);

      logger.info('Starting serve-sim remote session.');

      logger.info(`Selecting Xcode developer directory: ${XCODE_DEVELOPER_DIR}.`);
      await spawn('sudo', ['xcode-select', '-s', XCODE_DEVELOPER_DIR], { env, logger });

      logger.info('Ensuring cloudflared is installed.');
      await ensureBrewPackageInstalledAsync({ name: 'cloudflared', env, logger });

      logger.info('Launching serve-sim with tunnel.');
      const serveSim = spawnDetached({
        command: 'npx',
        args: ['serve-sim-szdziedzic@latest', '--tunnel'],
        env,
      });

      logger.info('Waiting for serve-sim to report tunnel and stream URLs.');
      const { previewUrl, streamUrl } = await waitForServeSimUrlsAsync({
        serveSim,
        timeoutMs: STARTUP_TIMEOUT_MS,
      });
      logger.info(`Preview URL: ${previewUrl}`);
      logger.info(`Stream URL: ${streamUrl}`);

      await uploadRemoteSessionConfigAsync({
        ctx,
        deviceRunSessionId,
        remoteConfig: { previewUrl, streamUrl },
        logger,
      });

      logger.info('Remote session is live. Keeping the job alive until the session is stopped.');
      // Keep the turtle job alive so the serve-sim tunnel stays reachable
      // until stopDeviceRunSession cancels the run.
      await new Promise<never>(() => {});
    },
  });
}

async function waitForServeSimUrlsAsync({
  serveSim,
  timeoutMs,
}: {
  serveSim: DetachedProcessHandle;
  timeoutMs: number;
}): Promise<{ previewUrl: string; streamUrl: string }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const output = serveSim.getOutput();
    const previewUrl = matchLabeledUrl(output, 'Tunnel');
    const streamUrl = matchLabeledUrl(output, 'Stream');
    if (previewUrl && streamUrl) {
      return { previewUrl, streamUrl };
    }
    await sleepAsync(1_000);
  }
  throw new SystemError(
    `Timed out waiting for serve-sim to report Tunnel and Stream URLs. Last output:\n${serveSim.getOutput() || '<empty>'}`
  );
}

function matchLabeledUrl(content: string, label: string): string | null {
  const labelPattern = new RegExp(`${label}:\\s*(${TRYCLOUDFLARE_URL_PATTERN.source})`);
  const match = labelPattern.exec(content);
  return match ? match[1] : null;
}
