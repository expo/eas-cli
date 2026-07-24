import { EasCommandError } from '../commandUtils/errors';
import { GraphqlError } from '../graphql/client';

// Must match the server's Observe plan-gate error codes (`ExpoErrorCode`). Both
// signal "this Observe feature is not available on the account's current plan";
// they differ only in which plans are blocked, which is decided server-side.
export const EAS_OBSERVE_PLAN_UPGRADE_REQUIRED_ERROR_CODE = 'EAS_OBSERVE_PLAN_UPGRADE_REQUIRED';
export const EAS_OBSERVE_FEATURE_NOT_AVAILABLE_IN_FREE_TIER_ERROR_CODE =
  'EAS_OBSERVE_FEATURE_NOT_AVAILABLE_IN_FREE_TIER';

const OBSERVE_PLAN_GATE_ERROR_CODES: ReadonlySet<string> = new Set([
  EAS_OBSERVE_PLAN_UPGRADE_REQUIRED_ERROR_CODE,
  EAS_OBSERVE_FEATURE_NOT_AVAILABLE_IN_FREE_TIER_ERROR_CODE,
]);

function findObservePlanGateMessage(error: unknown): string | undefined {
  if (!(error instanceof GraphqlError)) {
    return undefined;
  }
  return error.graphQLErrors.find(e =>
    OBSERVE_PLAN_GATE_ERROR_CODES.has(e?.extensions?.errorCode as string)
  )?.message;
}

/**
 * Whether an error is a server Observe plan-gate rejection. Useful where a
 * plan-gate error must escape error handling that would otherwise swallow it
 * (e.g. per-platform fetch loops that treat failures as empty results).
 */
export function isObservePlanGateError(error: unknown): boolean {
  return findObservePlanGateMessage(error) !== undefined;
}

/**
 * Runs an Observe GraphQL operation and, when the server rejects it because the
 * feature is not included in the account's plan, rethrows the server's upgrade
 * message (which links to the account's billing page) as an `EasCommandError`.
 * Reusable across Observe commands.
 */
export async function withObservePlanGateHandlingAsync<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    const planGateMessage = findObservePlanGateMessage(error);
    if (planGateMessage !== undefined) {
      throw new EasCommandError(planGateMessage);
    }
    throw error;
  }
}
