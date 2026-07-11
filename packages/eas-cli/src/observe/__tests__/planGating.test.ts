import { CombinedError } from '@urql/core';
import { GraphQLError } from 'graphql';

import { EasCommandError } from '../../commandUtils/errors';
import {
  EAS_OBSERVE_PLAN_UPGRADE_REQUIRED_ERROR_CODE,
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

  it('surfaces the server plan-gate message as an EasCommandError', async () => {
    const serverMessage =
      'Access to this feature is not included in your current plan. ' +
      'Upgrade your plan: https://expo.dev/accounts/acme/settings/billing';
    const promise = withObservePlanGateHandlingAsync(() => {
      throw graphqlErrorWithCode(EAS_OBSERVE_PLAN_UPGRADE_REQUIRED_ERROR_CODE, serverMessage);
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
