import { type bunyan } from '@expo/logger';
import { BuildStepContext, BuildStepEnv } from '@expo/steps';

import { ServeSimMetricsRecorder } from '../../utils/serveSimMetricsRecorder';
import { startGuestMetricsAsync } from '../../utils/guestMetricsRecorder';
import { createStartServeSimMetricsBuildFunction } from '../startServeSimMetrics';

jest.mock('../../utils/serveSimMetricsRecorder');
jest.mock('../../utils/guestMetricsRecorder');

function createLoggerMock(): bunyan {
  return { info: jest.fn(), warn: jest.fn() } as unknown as bunyan;
}

describe(createStartServeSimMetricsBuildFunction, () => {
  it('starts serve-sim metrics polling', async () => {
    const logger = createLoggerMock();
    const fn = createStartServeSimMetricsBuildFunction().fn;
    await fn?.({ logger } as unknown as BuildStepContext, {
      inputs: {},
      outputs: {},
      env: {} as BuildStepEnv,
    });
    expect(ServeSimMetricsRecorder.startAsync).toHaveBeenCalledWith({ logger });
    expect(startGuestMetricsAsync).not.toHaveBeenCalled();
  });

  it('starts guest metrics only when requested and tolerates collector failure', async () => {
    jest.mocked(startGuestMetricsAsync).mockRejectedValueOnce(new Error('unavailable'));
    const logger = createLoggerMock();
    await createStartServeSimMetricsBuildFunction().fn?.(
      { logger } as unknown as BuildStepContext,
      {
        inputs: {},
        outputs: {},
        env: { EAS_DEVICE_RUN_GUEST_METRICS: '1' } as BuildStepEnv,
      }
    );
    expect(startGuestMetricsAsync).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalled();
    expect(ServeSimMetricsRecorder.startAsync).toHaveBeenCalledWith({ logger });
  });
});
