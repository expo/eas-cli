import { type bunyan } from '@expo/logger';
import { BuildRuntimePlatform, type BuildStepContext, type BuildStepEnv } from '@expo/steps';

import { type CustomBuildContext } from '../../../customBuildContext';
import { startDeviceSessionHostAsync } from '../../utils/deviceSessionHost';
import {
  getDeviceRunSessionIdOrThrow,
  getNgrokTunnelDomainOrThrow,
  selectXcodeDeveloperDirectoryAsync,
  uploadRemoteSessionConfigAsync,
  waitForDeviceRunSessionStoppedAsync,
} from '../../utils/remoteDeviceRunSession';
import { createStartWebPreviewRemoteSessionBuildFunction } from '../startWebPreviewRemoteSession';

jest.mock('../../utils/deviceSessionHost');
jest.mock('../../utils/remoteDeviceRunSession');

const ctx = {} as CustomBuildContext;
const env = {} as BuildStepEnv;
const logger = { info: jest.fn(), warn: jest.fn() } as unknown as bunyan;
const stopAsync = jest.fn();

async function runAsync(runtimePlatform: BuildRuntimePlatform): Promise<void> {
  const buildFunction = createStartWebPreviewRemoteSessionBuildFunction(ctx);
  await buildFunction.fn!(
    {
      logger,
      global: { runtimePlatform },
    } as unknown as BuildStepContext,
    {
      inputs: {
        package_version: { value: '1.2.3' },
        max_duration_seconds: { value: 120 },
      },
      outputs: {},
      env,
    } as never
  );
}

describe(createStartWebPreviewRemoteSessionBuildFunction, () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(getDeviceRunSessionIdOrThrow).mockReturnValue('device-run-session-id');
    jest.mocked(getNgrokTunnelDomainOrThrow).mockReturnValue('tunnel.example.com');
    jest.mocked(selectXcodeDeveloperDirectoryAsync).mockResolvedValue(undefined);
    jest.mocked(startDeviceSessionHostAsync).mockResolvedValue({
      openPreviewAsync: jest.fn().mockResolvedValue({
        previewPageUrl: 'https://expo.dev/simulator-preview/preview-id',
        apiUrl: 'https://web-preview.example.test',
        closeAsync: jest.fn(),
      }),
      finishAsync: stopAsync,
    });
    jest.mocked(uploadRemoteSessionConfigAsync).mockResolvedValue(undefined);
    jest.mocked(waitForDeviceRunSessionStoppedAsync).mockResolvedValue(undefined);
    stopAsync.mockResolvedValue(undefined);
  });

  it('reports the session token when serve-sim minted one', async () => {
    jest.mocked(startDeviceSessionHostAsync).mockResolvedValue({
      openPreviewAsync: jest.fn().mockResolvedValue({
        previewPageUrl: 'https://expo.dev/simulator-preview/preview-id',
        apiUrl: 'https://web-preview.example.test',
        previewToken: 'tok-1',
        closeAsync: jest.fn(),
      }),
      finishAsync: stopAsync,
    });

    await runAsync(BuildRuntimePlatform.DARWIN);

    expect(uploadRemoteSessionConfigAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        remoteConfig: {
          previewUrl: 'https://expo.dev/simulator-preview/preview-id',
          previewApiUrl: 'https://web-preview.example.test',
          previewToken: 'tok-1',
        },
      })
    );
  });

  it.each(['preview', 'config', 'wait'])('finishes the session after %s fails', async phase => {
    const error = new Error(`${phase} failed`);
    if (phase === 'preview') {
      jest.mocked(startDeviceSessionHostAsync).mockResolvedValueOnce({
        openPreviewAsync: jest.fn().mockRejectedValue(error),
        finishAsync: stopAsync,
      });
    } else if (phase === 'config') {
      jest.mocked(uploadRemoteSessionConfigAsync).mockRejectedValueOnce(error);
    } else {
      jest.mocked(waitForDeviceRunSessionStoppedAsync).mockRejectedValueOnce(error);
    }
    await expect(runAsync(BuildRuntimePlatform.LINUX)).rejects.toBe(error);
    expect(stopAsync).toHaveBeenCalledTimes(1);
  });

  it.each([
    [BuildRuntimePlatform.DARWIN, true],
    [BuildRuntimePlatform.LINUX, false],
  ])('starts the web preview for %s', async (runtimePlatform, selectsXcode) => {
    await runAsync(runtimePlatform);

    expect(selectXcodeDeveloperDirectoryAsync).toHaveBeenCalledTimes(selectsXcode ? 1 : 0);
    expect(startDeviceSessionHostAsync).toHaveBeenCalledWith(ctx, {
      runtimePlatform,
      env,
      logger,
      timeoutMs: 60_000,
      packageVersion: '1.2.3',
    });
    expect(uploadRemoteSessionConfigAsync).toHaveBeenCalledWith({
      ctx,
      deviceRunSessionId: 'device-run-session-id',
      remoteConfig: {
        previewUrl: 'https://expo.dev/simulator-preview/preview-id',
        previewApiUrl: 'https://web-preview.example.test',
      },
      logger,
    });
    expect(waitForDeviceRunSessionStoppedAsync).toHaveBeenCalledWith({
      ctx,
      deviceRunSessionId: 'device-run-session-id',
      logger,
      maxDurationSeconds: 120,
      signal: undefined,
    });
    expect(stopAsync).toHaveBeenCalledTimes(1);
  });
});
