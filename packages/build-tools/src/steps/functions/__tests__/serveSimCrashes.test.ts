import { type bunyan } from '@expo/logger';
import { type BuildStepContext, type BuildStepEnv } from '@expo/steps';
import { access, mkdir, writeFile } from 'node:fs/promises';

import { type CustomBuildContext } from '../../../customBuildContext';
import { Sentry } from '../../../sentry';
import { getDeviceRunSessionIdOrThrow } from '../../utils/remoteDeviceRunSession';
import { uploadServeSimCrashesFileAsync } from '../../utils/serveSimCrashesArtifacts';
import { ServeSimCrashesRecorder } from '../../utils/serveSimCrashesRecorder';
import { createCollectServeSimCrashesBuildFunction } from '../collectServeSimCrashes';
import { createStartServeSimCrashesBuildFunction } from '../startServeSimCrashes';

jest.mock('../../../sentry');
jest.mock('../../utils/serveSimCrashesRecorder');
jest.mock('../../utils/serveSimCrashesArtifacts');
jest.mock('../../utils/remoteDeviceRunSession');

const logger = { info: jest.fn(), warn: jest.fn() } as unknown as bunyan;
const ctx = {} as CustomBuildContext;
const step = { logger } as BuildStepContext;
const args = { inputs: {}, outputs: {}, env: {} as BuildStepEnv };

beforeEach(() => {
  jest.mocked(getDeviceRunSessionIdOrThrow).mockReturnValue('session-id');
  jest
    .mocked(ServeSimCrashesRecorder.finishAsync)
    .mockResolvedValue({ outputDirectory: null, crashes: [] });
});

it('starts collection and tolerates startup failures', async () => {
  jest.mocked(ServeSimCrashesRecorder.startAsync).mockRejectedValueOnce(new Error('disk failure'));
  await expect(createStartServeSimCrashesBuildFunction().fn?.(step, args)).resolves.toBeUndefined();
  expect(logger.warn).toHaveBeenCalled();
  expect(Sentry.capture).toHaveBeenCalledWith(
    'Could not start serve-sim simulator crashes',
    expect.any(Error)
  );
});

it('uploads each device and removes the collection directory', async () => {
  const directory = '/tmp/crashes-collected';
  await mkdir(directory, { recursive: true });
  await writeFile(`${directory}/A.ndjson`, 'private crash report');
  jest.mocked(ServeSimCrashesRecorder.finishAsync).mockResolvedValue({
    outputDirectory: directory,
    crashes: [
      { udid: 'A', filePath: `${directory}/A.ndjson` },
      { udid: 'B', filePath: `${directory}/B.ndjson` },
    ],
  });
  await createCollectServeSimCrashesBuildFunction(ctx).fn?.(step, args);
  expect(uploadServeSimCrashesFileAsync).toHaveBeenCalledTimes(2);
  expect(uploadServeSimCrashesFileAsync).toHaveBeenCalledWith(
    ctx,
    expect.objectContaining({
      deviceRunSessionId: 'session-id',
      udid: 'A',
      filePath: `${directory}/A.ndjson`,
    })
  );
  await expect(access(directory)).rejects.toMatchObject({ code: 'ENOENT' });
});

it('gives each device its own 30-second upload budget', async () => {
  jest.mocked(ServeSimCrashesRecorder.finishAsync).mockResolvedValue({
    outputDirectory: null,
    crashes: [
      { udid: 'A', filePath: '/tmp/A.ndjson' },
      { udid: 'B', filePath: '/tmp/B.ndjson' },
    ],
  });
  const timeout = jest.spyOn(AbortSignal, 'timeout');
  try {
    await createCollectServeSimCrashesBuildFunction(ctx).fn?.(step, args);
    expect(timeout.mock.calls).toEqual([[30_000], [30_000]]);
    const signals = jest
      .mocked(uploadServeSimCrashesFileAsync)
      .mock.calls.map(([, file]) => file.signal);
    expect(signals).toEqual([expect.any(AbortSignal), expect.any(AbortSignal)]);
    expect(signals[0]).not.toBe(signals[1]);
  } finally {
    timeout.mockRestore();
  }
});

it('skips empty collection and warns on finalization failure', async () => {
  await createCollectServeSimCrashesBuildFunction(ctx).fn?.(step, args);
  expect(uploadServeSimCrashesFileAsync).not.toHaveBeenCalled();
  jest.mocked(ServeSimCrashesRecorder.finishAsync).mockRejectedValueOnce(new Error('failure'));
  await expect(
    createCollectServeSimCrashesBuildFunction(ctx).fn?.(step, args)
  ).resolves.toBeUndefined();
  expect(logger.warn).toHaveBeenCalled();
  expect(Sentry.capture).toHaveBeenCalledWith(
    'Could not finalize serve-sim simulator crashes',
    expect.any(Error)
  );
});

it('removes the collection directory when no crashes were recorded', async () => {
  const outputDirectory = '/tmp/empty-crashes-collected';
  await mkdir(outputDirectory, { recursive: true });
  jest.mocked(ServeSimCrashesRecorder.finishAsync).mockResolvedValue({
    outputDirectory,
    crashes: [],
  });
  await createCollectServeSimCrashesBuildFunction(ctx).fn?.(step, args);
  await expect(access(outputDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(uploadServeSimCrashesFileAsync).not.toHaveBeenCalled();
});

it('removes the collection directory when session resolution fails', async () => {
  const outputDirectory = '/tmp/unresolved-crashes-collected';
  await mkdir(outputDirectory, { recursive: true });
  jest.mocked(ServeSimCrashesRecorder.finishAsync).mockResolvedValue({
    outputDirectory,
    crashes: [{ udid: 'A', filePath: `${outputDirectory}/A.ndjson` }],
  });
  jest.mocked(getDeviceRunSessionIdOrThrow).mockImplementationOnce(() => {
    throw new Error('Missing session ID');
  });
  await expect(
    createCollectServeSimCrashesBuildFunction(ctx).fn?.(step, args)
  ).resolves.toBeUndefined();
  await expect(access(outputDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(uploadServeSimCrashesFileAsync).not.toHaveBeenCalled();
});
