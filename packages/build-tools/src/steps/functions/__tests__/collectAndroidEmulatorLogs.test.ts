import { BuildRuntimePlatform, type BuildStepContext, type BuildStepEnv } from '@expo/steps';

import { createMockLogger } from '../../../__tests__/utils/logger';
import { type CustomBuildContext } from '../../../customBuildContext';
import { Sentry } from '../../../sentry';
import { collectAndroidEmulatorLogsAsync } from '../../utils/androidEmulatorLogs';
import { createCollectAndroidEmulatorLogsBuildFunction } from '../collectAndroidEmulatorLogs';

jest.mock('../../../sentry');
jest.mock('../../utils/androidEmulatorLogs');

const logger = createMockLogger();
const ctx = {} as CustomBuildContext;
const global = {} as BuildStepContext['global'];
const step = { logger, global } as BuildStepContext;
const args = { inputs: {}, outputs: {}, env: { DEVICE_RUN_SESSION_ID: 'session' } as BuildStepEnv };

it('collects logs for its own workflow and session without inputs', async () => {
  const fn = createCollectAndroidEmulatorLogsBuildFunction(ctx);
  expect(fn.supportedRuntimePlatforms).toEqual([BuildRuntimePlatform.LINUX]);
  await fn.fn?.(step, args);
  expect(collectAndroidEmulatorLogsAsync).toHaveBeenCalledWith(ctx, {
    global,
    deviceRunSessionId: 'session',
    logger,
  });
});

it('reports collection failure without changing the session result', async () => {
  jest
    .mocked(collectAndroidEmulatorLogsAsync)
    .mockRejectedValueOnce(new Error('collection failed'));
  await expect(
    createCollectAndroidEmulatorLogsBuildFunction(ctx).fn?.(step, args)
  ).resolves.toBeUndefined();
  expect(logger.warn).toHaveBeenCalled();
  expect(Sentry.capture).toHaveBeenCalledWith(
    'Could not collect Android emulator logs',
    expect.any(Error)
  );
});
