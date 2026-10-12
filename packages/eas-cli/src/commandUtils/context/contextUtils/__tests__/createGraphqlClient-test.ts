import { createRequest } from '@urql/core';
import http from 'http';
import { AddressInfo } from 'net';

import { createGraphqlClient } from '../createGraphqlClient';

jest.mock('../../../../api', () => ({
  getExpoApiBaseUrl: () => process.env.CREATE_GRAPHQL_CLIENT_TEST_URL,
}));

// A plain string keeps this document out of GraphQL codegen, which scans gql tags in src/**.
const TEST_QUERY = 'query CreateGraphqlClientTest { __typename }';

function fetchOptionsOf(client: ReturnType<typeof createGraphqlClient>): RequestInit {
  const operation = client.createRequestOperation('query', createRequest(TEST_QUERY, {}));
  const { fetchOptions } = operation.context;
  return typeof fetchOptions === 'function' ? fetchOptions() : (fetchOptions ?? {});
}

/** Serves one GraphQL response after `delayMs`. Returns the base URL. */
async function startSlowServerAsync(server: http.Server, delayMs: number): Promise<string> {
  server.on('request', (_req, res) => {
    setTimeout(() => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ data: { __typename: 'RootQuery' } }));
    }, delayMs);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

describe(createGraphqlClient, () => {
  it('sends the access token as a bearer header', () => {
    const init = fetchOptionsOf(createGraphqlClient({ accessToken: 'token', sessionSecret: null }));
    expect(init.headers).toEqual({ authorization: 'Bearer token' });
  });

  it('sends the session secret when there is no access token', () => {
    const init = fetchOptionsOf(
      createGraphqlClient({ accessToken: null, sessionSecret: 'secret' })
    );
    expect(init.headers).toEqual({ 'expo-session': 'secret' });
  });

  it('keeps the auth headers when a request timeout is set', () => {
    const init = fetchOptionsOf(
      createGraphqlClient({ accessToken: 'token', sessionSecret: null }, { requestTimeoutMs: 50 })
    );
    expect(init.headers).toEqual({ authorization: 'Bearer token' });
  });

  describe('against a slow server', () => {
    const server = http.createServer();
    const serverDelayMs = 2000;

    beforeAll(async () => {
      process.env.CREATE_GRAPHQL_CLIENT_TEST_URL = await startSlowServerAsync(
        server,
        serverDelayMs
      );
    });

    afterAll(async () => {
      delete process.env.CREATE_GRAPHQL_CLIENT_TEST_URL;
      server.closeAllConnections();
      await new Promise<void>(resolve => {
        server.close(() => {
          resolve();
        });
      });
    });

    it('aborts the request when the timeout elapses', async () => {
      // Only a real request proves the timeout works.
      const client = createGraphqlClient(
        { accessToken: 'token', sessionSecret: null },
        { requestTimeoutMs: 100 }
      );
      const start = Date.now();
      const result = await client.query(TEST_QUERY, {}, { noRetry: true }).toPromise();
      expect(Date.now() - start).toBeLessThan(serverDelayMs);
      expect(result.data).toBeUndefined();
      expect(result.error?.networkError?.name).toBe('TimeoutError');
      expect(result.error?.networkError?.message).toBe('Request timed out after 100 ms');
    });

    it('waits for the response when no timeout is set', async () => {
      const client = createGraphqlClient({ accessToken: 'token', sessionSecret: null });
      const result = await client.query(TEST_QUERY, {}, { noRetry: true }).toPromise();
      expect(result.error).toBeUndefined();
      expect(result.data).toEqual({ __typename: 'RootQuery' });
    });
  });
});
