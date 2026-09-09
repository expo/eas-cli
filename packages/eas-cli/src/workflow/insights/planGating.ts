import { EasCommandError } from '../../commandUtils/errors';
import { findPlanGateError } from '../../commandUtils/planGating';

// Must match the server's plan-gate error codes (`ExpoErrorCode`).
export const EAS_WORKFLOWS_INSIGHTS_NOT_AVAILABLE_ERROR_CODE =
  'EAS_WORKFLOWS_INSIGHTS_NOT_AVAILABLE';
export const EAS_WORKFLOWS_INSIGHTS_TIMESPAN_LIMIT_EXCEEDED_ERROR_CODE =
  'EAS_WORKFLOWS_INSIGHTS_TIMESPAN_LIMIT_EXCEEDED';
export const EAS_WORKFLOW_DEVICE_TEST_CASE_INSIGHTS_NOT_AVAILABLE_ERROR_CODE =
  'EAS_WORKFLOW_DEVICE_TEST_CASE_INSIGHTS_NOT_AVAILABLE';
export const EAS_WORKFLOW_DEVICE_TEST_CASE_INSIGHTS_TIMESPAN_LIMIT_EXCEEDED_ERROR_CODE =
  'EAS_WORKFLOW_DEVICE_TEST_CASE_INSIGHTS_TIMESPAN_LIMIT_EXCEEDED';

const PLAN_GATE_ERROR_CODES: ReadonlySet<string> = new Set([
  EAS_WORKFLOWS_INSIGHTS_NOT_AVAILABLE_ERROR_CODE,
  EAS_WORKFLOWS_INSIGHTS_TIMESPAN_LIMIT_EXCEEDED_ERROR_CODE,
  EAS_WORKFLOW_DEVICE_TEST_CASE_INSIGHTS_NOT_AVAILABLE_ERROR_CODE,
  EAS_WORKFLOW_DEVICE_TEST_CASE_INSIGHTS_TIMESPAN_LIMIT_EXCEEDED_ERROR_CODE,
]);

/** Plan-gate rejections from either insights surface become a plain error message. */
export async function withInsightsPlanGateHandlingAsync<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    const planGateError = findPlanGateError(error, PLAN_GATE_ERROR_CODES);
    if (!planGateError) {
      throw error;
    }
    const limitDays = (planGateError.extensions?.metadata as { limitDays?: unknown } | undefined)
      ?.limitDays;
    const limitText =
      typeof limitDays === 'number' ? ` Your plan includes the last ${limitDays} days.` : '';
    throw new EasCommandError(`${planGateError.message}${limitText}`);
  }
}
