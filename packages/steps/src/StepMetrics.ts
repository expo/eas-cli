export type StepMetricResult = 'success' | 'failed';

export type StepMetricInput = {
  metricsId: string;
  result: StepMetricResult;
  durationMs: number;
};

export type StepMetric = StepMetricInput & {
  platform: 'darwin' | 'linux';
};

/**
 * One `eas.workflow.hook` event, reported per executed authored hook entry (a
 * `uses:` group hook is ONE event with the entry's aggregated result; skipped
 * hooks report nothing). `anchorResult` is set only on after-timing events and
 * reflects the anchor's LOCAL outcome, not the global failure flag.
 */
export type WorkflowHookMetric = {
  anchor: string;
  timing: 'before' | 'after';
  kind: 'run' | 'uses';
  result: StepMetricResult;
  anchorResult?: StepMetricResult;
};
