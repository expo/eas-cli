import { type bunyan } from '@expo/logger';
import { type BuildStepContext, type BuildStepEnv } from '@expo/steps';

import { type CustomBuildContext } from '../../../customBuildContext';
import { Sentry } from '../../../sentry';
import { getDeviceRunSessionIdOrThrow } from '../../utils/remoteDeviceRunSession';
import { uploadServeSimLogsFileAsync } from '../../utils/serveSimLogsArtifacts';
import { ServeSimLogsRecorder } from '../../utils/serveSimLogsRecorder';
import { createCollectServeSimLogsBuildFunction } from '../collectServeSimLogs';
import { createStartServeSimLogsBuildFunction } from '../startServeSimLogs';

jest.mock('../../../sentry');
jest.mock('../../utils/serveSimLogsRecorder');
jest.mock('../../utils/serveSimLogsArtifacts');
jest.mock('../../utils/remoteDeviceRunSession');

const logger = { info: jest.fn(), warn: jest.fn() } as unknown as bunyan;
const ctx = {} as CustomBuildContext;
const step = { logger } as BuildStepContext;
const args = { inputs: {}, outputs: {}, env: {} as BuildStepEnv };

beforeEach(() => {
  jest.mocked(getDeviceRunSessionIdOrThrow).mockReturnValue('session-id');
  jest.mocked(ServeSimLogsRecorder.finishAsync).mockResolvedValue([]);
});

it('starts collection and tolerates startup failures', async () => {
  jest.mocked(ServeSimLogsRecorder.startAsync).mockRejectedValueOnce(new Error('disk failure'));
  await expect(createStartServeSimLogsBuildFunction().fn?.(step, args)).resolves.toBeUndefined();
  expect(logger.warn).toHaveBeenCalled();
  expect(Sentry.capture).toHaveBeenCalledWith(
    'Could not start serve-sim simulator logs',
    expect.any(Error)
  );
});

it('uploads each device with its own bounded signal', async () => {
  jest.mocked(ServeSimLogsRecorder.finishAsync).mockResolvedValue([
    { udid: 'A', filePath: '/tmp/A.ndjson' },
    { udid: 'B', filePath: '/tmp/B.ndjson' },
  ]);
  await createCollectServeSimLogsBuildFunction(ctx).fn?.(step, args);
  expect(uploadServeSimLogsFileAsync).toHaveBeenCalledTimes(2);
  expect(uploadServeSimLogsFileAsync).toHaveBeenCalledWith(
    ctx,
    expect.objectContaining({
      deviceRunSessionId: 'session-id',
      udid: 'A',
      filePath: '/tmp/A.ndjson',
      signal: expect.any(AbortSignal),
    })
  );
  expect(jest.mocked(uploadServeSimLogsFileAsync).mock.calls[0][1].signal).not.toBe(
    jest.mocked(uploadServeSimLogsFileAsync).mock.calls[1][1].signal
  );
});

it('skips empty collection and warns on finalization failure', async () => {
  await createCollectServeSimLogsBuildFunction(ctx).fn?.(step, args);
  expect(uploadServeSimLogsFileAsync).not.toHaveBeenCalled();
  jest.mocked(ServeSimLogsRecorder.finishAsync).mockRejectedValueOnce(new Error('failure'));
  await expect(
    createCollectServeSimLogsBuildFunction(ctx).fn?.(step, args)
  ).resolves.toBeUndefined();
  expect(logger.warn).toHaveBeenCalled();
  expect(Sentry.capture).toHaveBeenCalledWith(
    'Could not finalize serve-sim simulator logs',
    expect.any(Error)
  );
});
