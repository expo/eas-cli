import http from 'http';
import { AddressInfo } from 'net';

import { createGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { UserQuery } from '../UserQuery';

jest.mock('../../../api', () => ({
  getExpoApiBaseUrl: () => process.env.USER_QUERY_TEST_URL,
}));

describe(UserQuery.currentUserAsync, () => {
  describe('against a slow server', () => {
    const server = http.createServer();
    const serverDelayMs = 2000;
    const requestTimeoutMs = 100;
    let requestCount = 0;
    // Aborted requests leave their response timers pending; clear them so the worker can exit.
    const responseTimers: NodeJS.Timeout[] = [];

    beforeAll(async () => {
      server.on('request', (_req, res) => {
        requestCount += 1;
        responseTimers.push(
          setTimeout(() => {
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ data: { meActor: null } }));
          }, serverDelayMs)
        );
      });
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
      const { port } = server.address() as AddressInfo;
      process.env.USER_QUERY_TEST_URL = `http://127.0.0.1:${port}`;
    });

    beforeEach(() => {
      requestCount = 0;
    });

    afterAll(async () => {
      delete process.env.USER_QUERY_TEST_URL;
      for (const timer of responseTimers) {
        clearTimeout(timer);
      }
      server.closeAllConnections();
      await new Promise<void>(resolve => {
        server.close(() => {
          resolve();
        });
      });
    });

    it('fails after one timed-out request when retries are disabled', async () => {
      const client = createGraphqlClient(
        { accessToken: 'token', sessionSecret: null },
        { requestTimeoutMs }
      );
      await expect(UserQuery.currentUserAsync(client, { noRetry: true })).rejects.toThrow(
        `Request timed out after ${requestTimeoutMs} ms`
      );
      expect(requestCount).toBe(1);
    });

    it('retries a timed-out request by default', async () => {
      const client = createGraphqlClient(
        { accessToken: 'token', sessionSecret: null },
        { requestTimeoutMs }
      );
      await expect(UserQuery.currentUserAsync(client)).rejects.toThrow(
        `Request timed out after ${requestTimeoutMs} ms`
      );
      expect(requestCount).toBe(2);
    }, 15000);
  });
});
