export type StepMetricResult = 'success' | 'failed';

export type StepMetricInput = {
  metricsId: string;
  result: StepMetricResult;
  durationMs: number;
};

export type StepMetric = StepMetricInput & {
  platform: 'darwin' | 'linux';
};

export type StepMetricsCollection = StepMetric[];
