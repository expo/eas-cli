import http from 'http';
import { AddressInfo } from 'net';

import { createGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { DeviceRunSessionQuery } from '../DeviceRunSessionQuery';

jest.mock('../../../api', () => ({
  getExpoApiBaseUrl: () => process.env.DEVICE_RUN_SESSION_QUERY_TEST_URL,
}));

describe('DeviceRunSessionQuery.jobRunErrorsByIdAsync', () => {
  let server: http.Server;
  let closedRequests: number;

  async function startServerAsync(handler: http.RequestListener): Promise<void> {
    closedRequests = 0;
    server = http.createServer((request, response) => {
      request.socket.on('close', () => {
        closedRequests += 1;
      });
      handler(request, response);
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    process.env.DEVICE_RUN_SESSION_QUERY_TEST_URL = `http://127.0.0.1:${port}`;
  }

  afterEach(async () => {
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
    await startServerAsync((_request, response) => {
      response.setHeader('content-type', 'application/json');
      response.end(
        JSON.stringify({
          data: {
            deviceRunSessions: {
              __typename: 'DeviceRunSessionQuery',
              byId: { __typename: 'DeviceRunSession', id: 'session-123', turtleJobRun },
            },
          },
        })
      );
    });
    const client = createGraphqlClient({ accessToken: 'token', sessionSecret: null });

    await expect(
      DeviceRunSessionQuery.jobRunErrorsByIdAsync(client, 'session-123', {
        signal: new AbortController().signal,
      })
    ).resolves.toEqual(turtleJobRun);
  });

  it('rejects and cancels the request when the signal aborts', async () => {
    await startServerAsync(() => {});
    const client = createGraphqlClient({ accessToken: 'token', sessionSecret: null });
    const controller = new AbortController();
    setTimeout(() => {
      controller.abort(new Error('interrupted'));
    }, 100);

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
    const requests: string[] = [];
    await startServerAsync(request => {
      requests.push(request.url ?? '');
    });
    const client = createGraphqlClient({ accessToken: 'token', sessionSecret: null });
    const controller = new AbortController();
    controller.abort(new Error('interrupted'));

    await expect(
      DeviceRunSessionQuery.jobRunErrorsByIdAsync(client, 'session-123', {
        signal: controller.signal,
      })
    ).rejects.toThrow('interrupted');
    expect(requests).toEqual([]);
  });
});
