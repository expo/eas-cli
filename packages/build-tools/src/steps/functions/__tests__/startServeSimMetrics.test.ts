import { type bunyan } from '@expo/logger';
import { BuildStepContext, BuildStepEnv } from '@expo/steps';

import { ServeSimMetricsRecorder } from '../../utils/serveSimMetricsRecorder';
import { createStartServeSimMetricsBuildFunction } from '../startServeSimMetrics';

jest.mock('../../utils/serveSimMetricsRecorder');

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
  });
});
