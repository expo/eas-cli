import { type bunyan } from '@expo/logger';
import { type BuildStepContext, type BuildStepEnv } from '@expo/steps';
import { access, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

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

it('uploads each report and removes the collection directory', async () => {
  const directory = '/tmp/crashes-collected';
  await mkdir(directory, { recursive: true });
  await writeFile(`${directory}/A.ips`, 'private crash report');
  jest.mocked(ServeSimCrashesRecorder.finishAsync).mockResolvedValue({
    outputDirectory: directory,
    crashes: [
      { udid: 'A', filePath: `${directory}/A.ips`, size: 20, number: 1 },
      { udid: 'B', filePath: `${directory}/B.ips`, size: 20, number: 1 },
    ],
  });
  await createCollectServeSimCrashesBuildFunction(ctx).fn?.(step, args);
  expect(uploadServeSimCrashesFileAsync).toHaveBeenCalledTimes(2);
  expect(uploadServeSimCrashesFileAsync).toHaveBeenCalledWith(ctx, {
    deviceRunSessionId: 'session-id',
    crash: { udid: 'A', filePath: `${directory}/A.ips`, size: 20, number: 1 },
    logger,
    signal: expect.any(AbortSignal),
  });
  await expect(access(directory)).rejects.toMatchObject({ code: 'ENOENT' });
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

it.each([
  ['no crashes were recorded', [], false],
  ['session resolution fails', [{ udid: 'A', filePath: 'A.ips', size: 20, number: 1 }], true],
])('removes the collection directory when %s', async (_name, crashes, failSession) => {
  const outputDirectory = await mkdtemp(path.join(os.tmpdir(), 'crashes-collected-'));
  jest.mocked(ServeSimCrashesRecorder.finishAsync).mockResolvedValue({ outputDirectory, crashes });
  if (failSession) {
    jest.mocked(getDeviceRunSessionIdOrThrow).mockImplementationOnce(() => {
      throw new Error('Missing session ID');
    });
  }
  await expect(
    createCollectServeSimCrashesBuildFunction(ctx).fn?.(step, args)
  ).resolves.toBeUndefined();
  await expect(access(outputDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(uploadServeSimCrashesFileAsync).not.toHaveBeenCalled();
});

it('skips remaining reports for an exhausted device and continues with other devices', async () => {
  jest.mocked(ServeSimCrashesRecorder.finishAsync).mockResolvedValue({
    outputDirectory: null,
    crashes: [
      { udid: 'A', filePath: '/tmp/A-1.ips', size: 20, number: 1 },
      { udid: 'A', filePath: '/tmp/A-2.ips', size: 20, number: 2 },
      { udid: 'B', filePath: '/tmp/B-1.ips', size: 20, number: 1 },
    ],
  });
  const controller = new AbortController();
  const timeout = jest.spyOn(AbortSignal, 'timeout').mockReturnValueOnce(controller.signal);
  jest.mocked(uploadServeSimCrashesFileAsync).mockImplementationOnce(async () => {
    controller.abort(new Error('Upload budget exhausted'));
  });
  try {
    await createCollectServeSimCrashesBuildFunction(ctx).fn?.(step, args);
    expect(
      jest.mocked(uploadServeSimCrashesFileAsync).mock.calls.map(([, { crash }]) => crash.filePath)
    ).toEqual(['/tmp/A-1.ips', '/tmp/B-1.ips']);
    expect(logger.warn).toHaveBeenCalledWith(
      'Simulator crash upload reached its time limit for A; remaining reports will not be uploaded.'
    );
  } finally {
    timeout.mockRestore();
  }
});
