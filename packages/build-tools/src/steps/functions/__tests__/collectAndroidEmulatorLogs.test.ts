import { BuildRuntimePlatform } from '@expo/steps';

import {
  createCustomBuildContextMock,
  createGlobalContextMock,
} from '../../../__tests__/utils/context';
import { createMockLogger } from '../../../__tests__/utils/logger';
import { Sentry } from '../../../sentry';
import { collectAndroidEmulatorLogsAsync } from '../../utils/androidEmulatorLogs';
import { createCollectAndroidEmulatorLogsBuildFunction } from '../collectAndroidEmulatorLogs';

jest.mock('../../../sentry');
jest.mock('../../utils/androidEmulatorLogs');

function createStep(callInputs: Record<string, unknown> = {}) {
  const logger = createMockLogger();
  const ctx = createCustomBuildContextMock();
  const global = createGlobalContextMock({ logger });
  const fn = createCollectAndroidEmulatorLogsBuildFunction(ctx);
  const step = fn.createBuildStepFromFunctionCall(global, {
    callInputs,
    env: { DEVICE_RUN_SESSION_ID: 'session' },
  });
  return { ctx, global, logger, fn, step };
}

it('collects captured logs without a second source selection', async () => {
  const { ctx, global, fn, step } = createStep();
  expect(fn.supportedRuntimePlatforms).toEqual([BuildRuntimePlatform.LINUX]);
  await step.executeAsync();
  expect(collectAndroidEmulatorLogsAsync).toHaveBeenCalledWith(ctx, {
    global,
    deviceRunSessionId: 'session',
    logger: expect.anything(),
  });
});

it('reports collection failure without changing the session result', async () => {
  jest
    .mocked(collectAndroidEmulatorLogsAsync)
    .mockRejectedValueOnce(new Error('collection failed'));
  const { step } = createStep();
  await expect(step.executeAsync()).resolves.toBeUndefined();
  expect(Sentry.capture).toHaveBeenCalledWith(
    'Could not collect Android emulator logs',
    expect.any(Error)
  );
});
