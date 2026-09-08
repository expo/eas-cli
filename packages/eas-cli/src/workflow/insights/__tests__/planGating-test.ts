import { CombinedError } from '@urql/core';
import { GraphQLError } from 'graphql';

import { EasCommandError } from '../../../commandUtils/errors';
import {
  EAS_WORKFLOWS_INSIGHTS_NOT_AVAILABLE_ERROR_CODE,
  EAS_WORKFLOWS_INSIGHTS_TIMESPAN_LIMIT_EXCEEDED_ERROR_CODE,
  withWorkflowsInsightsPlanGateHandlingAsync,
} from '../planGating';

function graphqlErrorWithCode(
  errorCode: string,
  message = 'server message',
  metadata?: Record<string, unknown>
): CombinedError {
  const graphQLError = new GraphQLError(message, null, null, null, null, null, {
    errorCode,
    ...(metadata ? { metadata } : {}),
  });
  return new CombinedError({ graphQLErrors: [graphQLError] });
}

describe(withWorkflowsInsightsPlanGateHandlingAsync, () => {
  it('returns the value when the operation succeeds', async () => {
    await expect(withWorkflowsInsightsPlanGateHandlingAsync(async () => 42)).resolves.toBe(42);
  });

  it('surfaces the server message when the plan does not include insights', async () => {
    const promise = withWorkflowsInsightsPlanGateHandlingAsync(() => {
      throw graphqlErrorWithCode(
        EAS_WORKFLOWS_INSIGHTS_NOT_AVAILABLE_ERROR_CODE,
        'Workflow insights are not available for your current plan.'
      );
    });

    await expect(promise).rejects.toBeInstanceOf(EasCommandError);
    await expect(promise).rejects.toThrow(
      'Workflow insights are not available for your current plan.'
    );
  });

  it('appends the plan day limit when the server reports it', async () => {
    const promise = withWorkflowsInsightsPlanGateHandlingAsync(() => {
      throw graphqlErrorWithCode(
        EAS_WORKFLOWS_INSIGHTS_TIMESPAN_LIMIT_EXCEEDED_ERROR_CODE,
        'The selected timeframe exceeds the supported range.',
        { limitDays: 30 }
      );
    });

    await expect(promise).rejects.toThrow(
      'The selected timeframe exceeds the supported range. Your plan includes the last 30 days.'
    );
  });

  it('passes through GraphQL errors with a different code unchanged', async () => {
    const original = graphqlErrorWithCode('SOME_OTHER_ERROR');
    await expect(
      withWorkflowsInsightsPlanGateHandlingAsync(() => {
        throw original;
      })
    ).rejects.toBe(original);
  });

  it('passes through non-GraphQL errors unchanged', async () => {
    const original = new Error('network down');
    await expect(
      withWorkflowsInsightsPlanGateHandlingAsync(() => {
        throw original;
      })
    ).rejects.toBe(original);
  });
});
