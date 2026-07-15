import { WorkflowHookMetric } from '@expo/steps';

import { Datadog } from '../datadog';

/**
 * The engine's provider callback is the ONLY `eas.workflow.hook` emitter —
 * never emit directly on top. The turtle-job-runs proxy forwards these tags
 * as-is; the turtle-builds proxy (custom builds) also adds the standard build
 * tags (image, sdk_version, build_mode, …), the same as every build metric.
 */
export function reportWorkflowHookMetricToDatadog(metric: WorkflowHookMetric): void {
  Datadog.distribution('eas.workflow.hook', 1, {
    anchor: metric.anchor,
    timing: metric.timing,
    result: metric.result,
    ...(metric.anchorResult !== undefined ? { anchor_result: metric.anchorResult } : null),
  });
}
