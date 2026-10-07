import { createRequest } from '@urql/core';

import { createGraphqlClient } from '../createGraphqlClient';

function fetchOptionsOf(client: ReturnType<typeof createGraphqlClient>): RequestInit {
  // A plain string keeps this document out of GraphQL codegen, which scans gql tags in src/**.
  const operation = client.createRequestOperation(
    'query',
    createRequest('query CreateGraphqlClientTest { __typename }', {})
  );
  const { fetchOptions } = operation.context;
  return typeof fetchOptions === 'function' ? fetchOptions() : (fetchOptions ?? {});
}

describe(createGraphqlClient, () => {
  it('sends the access token as a bearer header', () => {
    const init = fetchOptionsOf(createGraphqlClient({ accessToken: 'token', sessionSecret: null }));
    expect(init.headers).toEqual({ authorization: 'Bearer token' });
    expect(init.signal).toBeUndefined();
  });

  it('sends the session secret when there is no access token', () => {
    const init = fetchOptionsOf(
      createGraphqlClient({ accessToken: null, sessionSecret: 'secret' })
    );
    expect(init.headers).toEqual({ 'expo-session': 'secret' });
  });

  it('adds an abort signal and keeps the auth headers when a request timeout is set', () => {
    const init = fetchOptionsOf(
      createGraphqlClient({ accessToken: 'token', sessionSecret: null }, { requestTimeoutMs: 50 })
    );
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.headers).toEqual({ authorization: 'Bearer token' });
  });
});
