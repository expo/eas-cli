import { GraphQLError } from 'graphql';

import { GraphqlError } from '../graphql/client';

export function findPlanGateError(
  error: unknown,
  errorCodes: ReadonlySet<string>
): GraphQLError | undefined {
  if (!(error instanceof GraphqlError)) {
    return undefined;
  }
  return error.graphQLErrors.find(e => errorCodes.has(e?.extensions?.errorCode as string));
}
