import { EasCommandError } from '../../commandUtils/errors';
import { GraphqlError } from '../../graphql/client';

// Must match the server's Workflows Insights plan-gate error codes (`ExpoErrorCode`).
export const EAS_WORKFLOWS_INSIGHTS_NOT_AVAILABLE_ERROR_CODE =
  'EAS_WORKFLOWS_INSIGHTS_NOT_AVAILABLE';
export const EAS_WORKFLOWS_INSIGHTS_TIMESPAN_LIMIT_EXCEEDED_ERROR_CODE =
  'EAS_WORKFLOWS_INSIGHTS_TIMESPAN_LIMIT_EXCEEDED';

const PLAN_GATE_ERROR_CODES: ReadonlySet<string> = new Set([
  EAS_WORKFLOWS_INSIGHTS_NOT_AVAILABLE_ERROR_CODE,
  EAS_WORKFLOWS_INSIGHTS_TIMESPAN_LIMIT_EXCEEDED_ERROR_CODE,
]);

/** Plan-gate rejections become a plain error message instead of a raw GraphQL error. */
export async function withWorkflowsInsightsPlanGateHandlingAsync<T>(
  fn: () => Promise<T>
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (!(error instanceof GraphqlError)) {
      throw error;
    }
    const planGateError = error.graphQLErrors.find(e =>
      PLAN_GATE_ERROR_CODES.has(e?.extensions?.errorCode as string)
    );
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
