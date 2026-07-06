import { WorkflowHookMetric } from '@expo/steps';

import { Datadog } from '../datadog';

/**
 * Emits one `eas.workflow.hook` distribution per executed authored hook entry
 * (the engine's provider callback is the ONLY emitter — never emit directly).
 * The turtle-job-runs proxy forwards these tags as-is; the turtle-builds proxy
 * (custom builds) also adds the standard build tags (image, sdk_version,
 * build_mode, …), the same as every build metric.
 */
export function reportWorkflowHookMetricToDatadog(
  metric: WorkflowHookMetric,
  { world }: { world: 'steps' | 'native' }
): void {
  Datadog.distribution('eas.workflow.hook', 1, {
    anchor: metric.anchor,
    timing: metric.timing,
    world,
    step_kind: metric.kind,
    result: metric.result,
    ...(metric.anchorResult !== undefined ? { anchor_result: metric.anchorResult } : null),
  });
}
