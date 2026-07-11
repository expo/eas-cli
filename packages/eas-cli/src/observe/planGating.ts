import { EasCommandError } from '../commandUtils/errors';
import { GraphqlError } from '../graphql/client';

// Must match the server's `ExpoErrorCode.EAS_OBSERVE_PLAN_UPGRADE_REQUIRED`.
// The server throws this for any EAS Observe feature not included in the
// account's current billing plan.
export const EAS_OBSERVE_PLAN_UPGRADE_REQUIRED_ERROR_CODE = 'EAS_OBSERVE_PLAN_UPGRADE_REQUIRED';

function findObservePlanGateMessage(error: unknown): string | undefined {
  if (!(error instanceof GraphqlError)) {
    return undefined;
  }
  return error.graphQLErrors.find(
    e => e?.extensions?.errorCode === EAS_OBSERVE_PLAN_UPGRADE_REQUIRED_ERROR_CODE
  )?.message;
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
