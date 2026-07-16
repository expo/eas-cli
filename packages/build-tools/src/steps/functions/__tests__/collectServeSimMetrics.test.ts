import { type bunyan } from '@expo/logger';
import { BuildStepContext, BuildStepEnv } from '@expo/steps';

import { type CustomBuildContext } from '../../../customBuildContext';
import { getDeviceRunSessionIdOrThrow } from '../../utils/remoteDeviceRunSession';
import { uploadServeSimMetricsFileAsync } from '../../utils/serveSimMetricsArtifacts';
import { ServeSimMetricsRecorder } from '../../utils/serveSimMetricsRecorder';
import { createCollectServeSimMetricsBuildFunction } from '../collectServeSimMetrics';

jest.mock('../../utils/serveSimMetricsRecorder');
jest.mock('../../utils/serveSimMetricsArtifacts');
jest.mock('../../utils/remoteDeviceRunSession');

function createLoggerMock(): bunyan {
  return { info: jest.fn(), warn: jest.fn() } as unknown as bunyan;
}

const ctx = {} as CustomBuildContext;

async function runAsync(logger: bunyan): Promise<void> {
  const fn = createCollectServeSimMetricsBuildFunction(ctx).fn;
  await fn?.({ logger } as unknown as BuildStepContext, {
    inputs: {},
    outputs: {},
    env: {} as BuildStepEnv,
  });
}

describe(createCollectServeSimMetricsBuildFunction, () => {
  beforeEach(() => {
    jest.mocked(getDeviceRunSessionIdOrThrow).mockReturnValue('session-id');
  });

  it('uploads a metrics file per collected device', async () => {
    jest.mocked(ServeSimMetricsRecorder.finishAsync).mockResolvedValue([
      { udid: 'AAAA', filePath: '/tmp/AAAA.ndjson' },
      { udid: 'BBBB', filePath: '/tmp/BBBB.ndjson' },
    ]);
    const logger = createLoggerMock();

    await runAsync(logger);

    expect(uploadServeSimMetricsFileAsync).toHaveBeenCalledTimes(2);
    expect(uploadServeSimMetricsFileAsync).toHaveBeenCalledWith(ctx, {
      deviceRunSessionId: 'session-id',
      udid: 'AAAA',
      filePath: '/tmp/AAAA.ndjson',
      logger,
    });
  });

  it('skips the upload when nothing was collected', async () => {
    jest.mocked(ServeSimMetricsRecorder.finishAsync).mockResolvedValue([]);

    await runAsync(createLoggerMock());

    expect(uploadServeSimMetricsFileAsync).not.toHaveBeenCalled();
  });

  it('warns instead of failing the session when the session id is missing', async () => {
    jest
      .mocked(ServeSimMetricsRecorder.finishAsync)
      .mockResolvedValue([{ udid: 'AAAA', filePath: '/tmp/AAAA.ndjson' }]);
    jest.mocked(getDeviceRunSessionIdOrThrow).mockImplementation(() => {
      throw new Error('missing DEVICE_RUN_SESSION_ID');
    });
    const logger = createLoggerMock();

    await expect(runAsync(logger)).resolves.toBeUndefined();

    expect(uploadServeSimMetricsFileAsync).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      'Could not upload serve-sim metrics.'
    );
  });
});
