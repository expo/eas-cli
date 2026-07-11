import { CombinedError } from '@urql/core';
import { GraphQLError } from 'graphql';

import { EasCommandError } from '../../commandUtils/errors';
import {
  EAS_OBSERVE_FEATURE_NOT_AVAILABLE_IN_FREE_TIER_ERROR_CODE,
  EAS_OBSERVE_PLAN_UPGRADE_REQUIRED_ERROR_CODE,
  isObservePlanGateError,
  withObservePlanGateHandlingAsync,
} from '../planGating';

function graphqlErrorWithCode(errorCode: string, message = 'server message'): CombinedError {
  const graphQLError = new GraphQLError(message, null, null, null, null, null, { errorCode });
  return new CombinedError({ graphQLErrors: [graphQLError] });
}

describe(withObservePlanGateHandlingAsync, () => {
  it('returns the value when the operation succeeds', async () => {
    await expect(withObservePlanGateHandlingAsync(async () => 42)).resolves.toBe(42);
  });

  it.each([
    ['plan-upgrade-required', EAS_OBSERVE_PLAN_UPGRADE_REQUIRED_ERROR_CODE],
    ['free-tier', EAS_OBSERVE_FEATURE_NOT_AVAILABLE_IN_FREE_TIER_ERROR_CODE],
  ])('surfaces the server %s message as an EasCommandError', async (_label, errorCode) => {
    const serverMessage = `gate message for ${errorCode}`;
    const promise = withObservePlanGateHandlingAsync(() => {
      throw graphqlErrorWithCode(errorCode, serverMessage);
    });

    await expect(promise).rejects.toBeInstanceOf(EasCommandError);
    await expect(promise).rejects.toThrow(serverMessage);
  });

  it('passes through GraphQL errors with a different code unchanged', async () => {
    const original = graphqlErrorWithCode('SOME_OTHER_ERROR');
    await expect(
      withObservePlanGateHandlingAsync(() => {
        throw original;
      })
    ).rejects.toBe(original);
  });

  it('passes through non-GraphQL errors unchanged', async () => {
    const original = new Error('network down');
    await expect(
      withObservePlanGateHandlingAsync(() => {
        throw original;
      })
    ).rejects.toBe(original);
  });
});

describe(isObservePlanGateError, () => {
  it.each([
    EAS_OBSERVE_PLAN_UPGRADE_REQUIRED_ERROR_CODE,
    EAS_OBSERVE_FEATURE_NOT_AVAILABLE_IN_FREE_TIER_ERROR_CODE,
  ])('is true for %s', errorCode => {
    expect(isObservePlanGateError(graphqlErrorWithCode(errorCode))).toBe(true);
  });

  it('is false for a different GraphQL error code', () => {
    expect(isObservePlanGateError(graphqlErrorWithCode('SOME_OTHER_ERROR'))).toBe(false);
  });

  it('is false for a non-GraphQL error', () => {
    expect(isObservePlanGateError(new Error('network down'))).toBe(false);
  });
});
