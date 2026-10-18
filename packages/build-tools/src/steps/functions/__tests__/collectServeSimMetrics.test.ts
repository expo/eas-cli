import { type bunyan } from '@expo/logger';
import { BuildStepContext, BuildStepEnv } from '@expo/steps';

import { type CustomBuildContext } from '../../../customBuildContext';
import { Sentry } from '../../../sentry';
import { getDeviceRunSessionIdOrThrow } from '../../utils/remoteDeviceRunSession';
import { uploadServeSimMetricsFileAsync } from '../../utils/serveSimMetricsArtifacts';
import { ServeSimMetricsRecorder } from '../../utils/serveSimMetricsRecorder';
import { createCollectServeSimMetricsBuildFunction } from '../collectServeSimMetrics';
import { finishGuestMetricsAsync } from '../../utils/guestMetricsRecorder';
import { uploadDeviceRunSessionArtifactAsync } from '../../utils/deviceRunSessionArtifacts';
import { stat } from 'node:fs/promises';

jest.mock('../../utils/serveSimMetricsRecorder');
jest.mock('../../utils/serveSimMetricsArtifacts');
jest.mock('../../utils/remoteDeviceRunSession');
jest.mock('../../../sentry');
jest.mock('../../utils/guestMetricsRecorder');
jest.mock('../../utils/deviceRunSessionArtifacts');
jest.mock('node:fs/promises', () => ({ stat: jest.fn() }));

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
      { udid: 'AAAA', filePath: '/tmp/AAAA.ndjson', metadata: { hostCores: 8 } },
      { udid: 'BBBB', filePath: '/tmp/BBBB.ndjson', metadata: undefined },
    ]);
    const logger = createLoggerMock();

    await runAsync(logger);

    expect(uploadServeSimMetricsFileAsync).toHaveBeenCalledTimes(2);
    expect(uploadServeSimMetricsFileAsync).toHaveBeenCalledWith(ctx, {
      deviceRunSessionId: 'session-id',
      udid: 'AAAA',
      filePath: '/tmp/AAAA.ndjson',
      metadata: { hostCores: 8 },
      logger,
    });
  });

  it('skips the upload when nothing was collected', async () => {
    jest.mocked(ServeSimMetricsRecorder.finishAsync).mockResolvedValue([]);

    await runAsync(createLoggerMock());

    expect(uploadServeSimMetricsFileAsync).not.toHaveBeenCalled();
  });

  it('uploads guest metrics even without a connected serve-sim metrics stream', async () => {
    jest.mocked(ServeSimMetricsRecorder.finishAsync).mockResolvedValue([]);
    jest.mocked(finishGuestMetricsAsync).mockResolvedValue('/tmp/guest-metrics.ndjson');
    jest.mocked(stat).mockResolvedValue({ size: 123 } as Awaited<ReturnType<typeof stat>>);
    await runAsync(createLoggerMock());
    expect(uploadDeviceRunSessionArtifactAsync).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        artifactId: 'guest-metrics',
        filename: 'guest-metrics.ndjson',
        size: 123,
        metadata: { schemaVersion: 1, scope: 'guest' },
      })
    );
  });

  it('still collects app metrics if guest telemetry fails', async () => {
    jest.mocked(finishGuestMetricsAsync).mockRejectedValue(new Error('disk failure'));
    jest.mocked(ServeSimMetricsRecorder.finishAsync).mockResolvedValue([]);
    const logger = createLoggerMock();
    await runAsync(logger);
    expect(logger.warn).toHaveBeenCalledWith(expect.anything(), 'Could not collect guest metrics.');
    expect(ServeSimMetricsRecorder.finishAsync).toHaveBeenCalled();
  });

  it('warns instead of failing the session when the session id is missing', async () => {
    jest
      .mocked(ServeSimMetricsRecorder.finishAsync)
      .mockResolvedValue([{ udid: 'AAAA', filePath: '/tmp/AAAA.ndjson', metadata: undefined }]);
    jest.mocked(getDeviceRunSessionIdOrThrow).mockImplementation(() => {
      throw new Error('missing DEVICE_RUN_SESSION_ID');
    });
    const logger = createLoggerMock();

    await expect(runAsync(logger)).resolves.toBeUndefined();

    expect(uploadServeSimMetricsFileAsync).not.toHaveBeenCalled();
    expect(Sentry.capture).toHaveBeenCalledWith(
      'Could not upload serve-sim metrics',
      expect.any(Error)
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      'Could not upload serve-sim metrics.'
    );
  });
});
