import { Job, StaticWorkflowInterpolationContext } from '@expo/eas-build-job';

/**
 * Build and generic jobs may carry a workflow interpolation context. Device run
 * session jobs never do.
 */
export function getWorkflowInterpolationContext(
  job: Job
): StaticWorkflowInterpolationContext | undefined {
  return 'workflowInterpolationContext' in job ? job.workflowInterpolationContext : undefined;
}
