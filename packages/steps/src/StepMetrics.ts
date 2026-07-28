import { HookAnchorId } from '@expo/eas-build-job';

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
 * One event per executed hook side (skipped hooks report nothing). `result` is
 * the hook's own outcome, aggregated across the side's entries; `anchorResult`
 * is the wrapped anchor step's outcome — after-timing only, and LOCAL: an
 * anchor running green past an earlier failure via `always()` is 'success'.
 */
export type WorkflowHookMetric = {
  anchor: HookAnchorId;
  timing: 'before' | 'after';
  result: StepMetricResult;
  anchorResult?: StepMetricResult;
};
