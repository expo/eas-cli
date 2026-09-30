import { bunyan } from '@expo/logger';
import { type BuildStepEnv } from '@expo/steps';
import { access, mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { type CustomBuildContext } from '../../../customBuildContext';
import { uploadNetworkCaptureHarsAsync } from '../../utils/networkCaptureArtifacts';
import { ServeSimNetworkCaptureRecorder } from '../../utils/serveSimNetworkCaptureRecorder';
import { createCollectServeSimNetworkCaptureBuildFunction } from '../collectServeSimNetworkCapture';
import { createStartServeSimNetworkCaptureBuildFunction } from '../startServeSimNetworkCapture';

jest.mock('../../../sentry');
jest.mock('../../utils/networkCaptureArtifacts');
jest.mock('../../utils/serveSimNetworkCaptureRecorder');

const ctx = {} as CustomBuildContext;
const logger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
} as unknown as bunyan;

type Fn = (stepCtx: unknown, options: unknown) => Promise<void>;
function runFn(
  fn: unknown,
  options: { env: BuildStepEnv; inputs?: Record<string, { value: unknown }> }
): Promise<void> {
  return (fn as Fn)({ logger }, { inputs: {}, ...options });
}

beforeEach(() => {
  jest.clearAllMocks();
});

it('starts the recorder with the session package version and never fails the step', async () => {
  const { fn } = createStartServeSimNetworkCaptureBuildFunction() as unknown as { fn: Fn };
  const env = {} as BuildStepEnv;
  await runFn(fn, { env, inputs: { package_version: { value: '0.5.0' } } });
  expect(ServeSimNetworkCaptureRecorder.startAsync).toHaveBeenCalledWith({
    logger,
    env,
    packageVersion: '0.5.0',
  });

  jest.mocked(ServeSimNetworkCaptureRecorder.startAsync).mockRejectedValueOnce(new Error('ENOSPC'));
  await expect(
    runFn(fn, { env, inputs: { package_version: { value: undefined } } })
  ).resolves.toBeUndefined();
  expect(logger.warn).toHaveBeenCalledWith(
    { err: expect.objectContaining({ message: 'ENOSPC' }) },
    'Could not start the serve-sim network capture recorder.'
  );
});

it('uploads the recorded HARs, then removes the recording directory', async () => {
  const outputDirectory = await mkdtemp(path.join(os.tmpdir(), 'serve-sim-network-capture-'));
  const captures = [
    { udid: 'SIM-A', filePath: path.join(outputDirectory, 'SIM-A-1.har'), size: 24 },
  ];
  jest
    .mocked(ServeSimNetworkCaptureRecorder.finishAsync)
    .mockResolvedValueOnce({ outputDirectory, captures });
  const { fn } = createCollectServeSimNetworkCaptureBuildFunction(ctx) as unknown as { fn: Fn };
  await runFn(fn, { env: { DEVICE_RUN_SESSION_ID: 'drs-id' } as BuildStepEnv });
  expect(uploadNetworkCaptureHarsAsync).toHaveBeenCalledWith(ctx, {
    deviceRunSessionId: 'drs-id',
    captures,
    logger,
  });
  await expect(access(outputDirectory)).rejects.toThrow();
});

it('does not fail the step without a device run session, and still removes the directory', async () => {
  const outputDirectory = await mkdtemp(path.join(os.tmpdir(), 'serve-sim-network-capture-'));
  jest.mocked(ServeSimNetworkCaptureRecorder.finishAsync).mockResolvedValueOnce({
    outputDirectory,
    captures: [{ udid: 'SIM-A', filePath: path.join(outputDirectory, 'SIM-A-1.har'), size: 24 }],
  });
  const { fn } = createCollectServeSimNetworkCaptureBuildFunction(ctx) as unknown as { fn: Fn };
  await expect(runFn(fn, { env: {} as BuildStepEnv })).resolves.toBeUndefined();
  expect(uploadNetworkCaptureHarsAsync).not.toHaveBeenCalled();
  expect(logger.warn).toHaveBeenCalledWith(
    { err: expect.any(Error) },
    'Could not upload the network capture.'
  );
  await expect(access(outputDirectory)).rejects.toThrow();
});

it('skips the upload when nothing was recorded', async () => {
  jest
    .mocked(ServeSimNetworkCaptureRecorder.finishAsync)
    .mockResolvedValueOnce({ outputDirectory: null, captures: [] });
  const { fn } = createCollectServeSimNetworkCaptureBuildFunction(ctx) as unknown as { fn: Fn };
  await runFn(fn, { env: { DEVICE_RUN_SESSION_ID: 'drs-id' } as BuildStepEnv });
  expect(uploadNetworkCaptureHarsAsync).not.toHaveBeenCalled();
  expect(logger.info).toHaveBeenCalledWith('No network capture was recorded; skipping upload.');
});
