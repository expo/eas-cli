import http from 'http';
import { AddressInfo } from 'net';

import { createGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import Log from '../../../log';
import { DeviceRunSessionQuery } from '../DeviceRunSessionQuery';

jest.mock('../../../api', () => ({
  getExpoApiBaseUrl: () => process.env.DEVICE_RUN_SESSION_QUERY_TEST_URL,
}));

describe('DeviceRunSessionQuery.jobRunErrorsByIdAsync', () => {
  let server: http.Server;
  let requests: number;
  let closedRequests: number;

  async function startServerAsync(handler: http.RequestListener): Promise<void> {
    requests = 0;
    closedRequests = 0;
    server = http.createServer((request, response) => {
      requests += 1;
      request.socket.on('close', () => {
        closedRequests += 1;
      });
      handler(request, response);
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    process.env.DEVICE_RUN_SESSION_QUERY_TEST_URL = `http://127.0.0.1:${port}`;
  }

  function respondWithJson(body: unknown): http.RequestListener {
    return (_request, response) => {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify(body));
    };
  }

  afterEach(async () => {
    jest.restoreAllMocks();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });

  it('returns the job run errors', async () => {
    const turtleJobRun = {
      __typename: 'JobRun',
      id: 'job-123',
      logFileUrls: ['https://logs.example.com/job-123'],
      errors: [
        {
          __typename: 'JobRunError',
          errorCode: 'UNKNOWN_ERROR',
          message: 'Unknown error.',
          docsUrl: null,
        },
      ],
    };
    await startServerAsync(
      respondWithJson({
        data: {
          deviceRunSessions: {
            __typename: 'DeviceRunSessionQuery',
            byId: { __typename: 'DeviceRunSession', id: 'session-123', turtleJobRun },
          },
        },
      })
    );
    const client = createGraphqlClient({ accessToken: 'token', sessionSecret: null });

    await expect(
      DeviceRunSessionQuery.jobRunErrorsByIdAsync(client, 'session-123', {
        signal: new AbortController().signal,
      })
    ).resolves.toEqual(turtleJobRun);
  });

  it('rejects without printing anything on a transient GraphQL error', async () => {
    const logErrorSpy = jest.spyOn(Log, 'error').mockImplementation(() => {});
    await startServerAsync(
      respondWithJson({
        data: null,
        errors: [{ message: 'Try again', extensions: { isTransient: true } }],
      })
    );
    const client = createGraphqlClient({ accessToken: 'token', sessionSecret: null });

    await expect(
      DeviceRunSessionQuery.jobRunErrorsByIdAsync(client, 'session-123', {
        signal: new AbortController().signal,
      })
    ).rejects.toThrow('Try again');
    expect(logErrorSpy).not.toHaveBeenCalled();
    expect(requests).toBe(1);
  });

  it('does not retry a network error', async () => {
    await startServerAsync(request => {
      request.socket.destroy();
    });
    const client = createGraphqlClient({ accessToken: 'token', sessionSecret: null });

    await expect(
      DeviceRunSessionQuery.jobRunErrorsByIdAsync(client, 'session-123', {
        signal: new AbortController().signal,
      })
    ).rejects.toThrow();
    expect(requests).toBe(1);
  });

  it('rejects and cancels the request when the signal aborts', async () => {
    const controller = new AbortController();
    await startServerAsync(() => {
      controller.abort(new Error('interrupted'));
    });
    const client = createGraphqlClient({ accessToken: 'token', sessionSecret: null });

    await expect(
      DeviceRunSessionQuery.jobRunErrorsByIdAsync(client, 'session-123', {
        signal: controller.signal,
      })
    ).rejects.toThrow('interrupted');
    for (let attempt = 0; attempt < 50 && closedRequests === 0; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    expect(closedRequests).toBe(1);
  });

  it('rejects without sending a request when the signal has already aborted', async () => {
    await startServerAsync(() => {});
    const client = createGraphqlClient({ accessToken: 'token', sessionSecret: null });
    const controller = new AbortController();
    controller.abort(new Error('interrupted'));

    await expect(
      DeviceRunSessionQuery.jobRunErrorsByIdAsync(client, 'session-123', {
        signal: controller.signal,
      })
    ).rejects.toThrow('interrupted');
    expect(requests).toBe(0);
  });
});
