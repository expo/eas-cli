import http from 'http';
import { AddressInfo } from 'net';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { DeviceRunSessionQuery } from '../../graphql/queries/DeviceRunSessionQuery';
import type LogType from '../../log';
import type * as JobRunErrors from '../jobRunErrors';

jest.mock('../../graphql/queries/DeviceRunSessionQuery');
jest.mock('../../log');

const mockJobRunErrorsByIdAsync = jest.mocked(DeviceRunSessionQuery.jobRunErrorsByIdAsync);
const graphqlClient = {} as ExpoGraphqlClient;
const unknownError = {
  errorCode: 'UNKNOWN_ERROR',
  message: 'Unknown error. See logs for more information.',
  docsUrl: null,
};

// src/fetch.ts reads https_proxy when it loads, so load it only after clearing the proxy.
let jobRunErrors: typeof JobRunErrors;
let Log: typeof LogType;
beforeAll(() => {
  delete process.env.https_proxy;
  jest.isolateModules(() => {
    jobRunErrors = jest.requireActual('../jobRunErrors');
    Log = jest.requireMock('../../log').default;
  });
});

// Lines 116-121 of a real failed Android session log, trimmed. The step's stderr has the precise
// cause at level 30; the level-50 error line only has the exit code.
const failedLaunchLog = [
  {
    level: 30,
    buildStepId: 'install_build',
    marker: 'end-step',
    result: 'success',
    msg: 'Finished build step "Install build" successfully',
  },
  {
    level: 30,
    buildStepId: 'install_build',
    source: 'stderr',
    msg: 'Error: Unable to find emulator skin, using default',
  },
  {
    level: 30,
    buildStepId: 'step-002',
    buildStepDisplayName: 'Launch application',
    marker: 'start-step',
    msg: 'Executing build step "Launch application"',
  },
  {
    level: 30,
    buildStepId: 'step-002',
    buildStepDisplayName: 'Launch application',
    source: 'stdout',
    msg: 'Starting: Intent { act=android.intent.action.MAIN pkg=world }',
  },
  {
    level: 30,
    buildStepId: 'step-002',
    buildStepDisplayName: 'Launch application',
    source: 'stderr',
    msg: 'Error: Activity not started, unable to resolve Intent { act=android.intent.action.MAIN pkg=world }',
  },
  {
    level: 50,
    buildStepId: 'step-002',
    buildStepDisplayName: 'Launch application',
    msg: 'adb shell am start -n dev.brent.euxy/.MainActivity exited with non-zero code: 1',
    err: {
      message: 'adb shell am start -n dev.brent.euxy/.MainActivity exited with non-zero code: 1',
    },
  },
  {
    level: 50,
    buildStepId: 'step-002',
    buildStepDisplayName: 'Launch application',
    marker: 'end-step',
    result: 'fail',
    msg: 'Build step "Launch application" failed',
  },
];

describe('selectFailedStepErrors', () => {
  it("shows the failed step's stderr cause before its error line", () => {
    expect(jobRunErrors.selectFailedStepErrors(failedLaunchLog)).toEqual([
      'Launch application: Error: Activity not started, unable to resolve Intent { act=android.intent.action.MAIN pkg=world }',
      'Launch application: adb shell am start -n dev.brent.euxy/.MainActivity exited with non-zero code: 1',
    ]);
  });

  it('ignores stderr from steps that did not fail', () => {
    const messages = jobRunErrors.selectFailedStepErrors(failedLaunchLog);
    expect(messages.join('\n')).not.toContain('emulator skin');
  });

  it('never prints the unmasked err.message of a phase failure with an empty message', () => {
    const phaseFailureLog = [
      { level: 30, phase: 'PREPARE_PROJECT', msg: 'Start phase: PREPARE_PROJECT' },
      {
        level: 50,
        phase: 'PREPARE_PROJECT',
        msg: '',
        err: {
          message: 'git clone https://secret-token@github.com/acme/app failed',
          stack: 'Error: git clone https://secret-token@github.com/acme/app failed',
        },
      },
    ];
    expect(jobRunErrors.selectFailedStepErrors(phaseFailureLog)).toEqual([]);
  });

  it('ignores errors outside of failed steps, such as errors a step ignored', () => {
    expect(
      jobRunErrors.selectFailedStepErrors([
        {
          level: 50,
          buildStepId: 'step-001',
          buildStepDisplayName: 'Upload artifact',
          msg: 'Failed to upload screen-recording. Ignoring error.',
          err: { message: 'upload failed' },
        },
        {
          level: 30,
          buildStepId: 'step-001',
          marker: 'end-step',
          result: 'success',
          msg: 'Finished',
        },
        {
          level: 50,
          msg: 'simctl boot failed for ********',
          err: { message: 'simctl boot failed for secret-udid' },
        },
      ])
    ).toEqual([]);
  });

  it('keeps the stderr line that continues the cause', () => {
    expect(
      jobRunErrors.selectFailedStepErrors([
        {
          level: 30,
          buildStepId: 'step-001',
          buildStepDisplayName: 'Boot simulator',
          source: 'stderr',
          msg: 'An error was encountered processing the command (domain=com.apple.CoreSimulator.SimError, code=405):',
        },
        {
          level: 30,
          buildStepId: 'step-001',
          buildStepDisplayName: 'Boot simulator',
          source: 'stderr',
          msg: 'Invalid device: iPhone 16 Pro',
        },
        {
          level: 50,
          buildStepId: 'step-001',
          buildStepDisplayName: 'Boot simulator',
          msg: 'xcrun simctl boot exited with non-zero code: 149',
          err: { message: 'xcrun simctl boot exited with non-zero code: 149' },
        },
        {
          level: 50,
          buildStepId: 'step-001',
          marker: 'end-step',
          result: 'fail',
          msg: 'Build step "Boot simulator" failed',
        },
      ])
    ).toEqual([
      'Boot simulator: An error was encountered processing the command (domain=com.apple.CoreSimulator.SimError, code=405):',
      'Boot simulator: Invalid device: iPhone 16 Pro',
      'Boot simulator: xcrun simctl boot exited with non-zero code: 149',
    ]);
  });

  it('keeps the cause of the first failed step when later steps also fail', () => {
    expect(
      jobRunErrors.selectFailedStepErrors([
        ...failedLaunchLog,
        {
          level: 30,
          buildStepId: 'step-003',
          buildStepDisplayName: 'Finish recordings',
          source: 'stderr',
          msg: 'Error: No devices are booted.',
        },
        {
          level: 50,
          buildStepId: 'step-003',
          buildStepDisplayName: 'Finish recordings',
          msg: 'xcrun simctl io recordVideo exited with non-zero code: 1',
          err: { message: 'x' },
        },
        {
          level: 50,
          buildStepId: 'step-003',
          marker: 'end-step',
          result: 'fail',
          msg: 'Build step "Finish recordings" failed',
        },
      ])
    ).toEqual([
      'Launch application: Error: Activity not started, unable to resolve Intent { act=android.intent.action.MAIN pkg=world }',
      'Launch application: adb shell am start -n dev.brent.euxy/.MainActivity exited with non-zero code: 1',
      'Finish recordings: xcrun simctl io recordVideo exited with non-zero code: 1',
    ]);
  });
});

describe('fetchSimulatorSessionErrorsAsync', () => {
  let server: http.Server;
  let closedRequests: number;

  async function startServerAsync(handler: http.RequestListener): Promise<string> {
    closedRequests = 0;
    server = http.createServer((request, response) => {
      request.socket.on('close', () => {
        closedRequests += 1;
      });
      handler(request, response);
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    return `http://127.0.0.1:${port}/logs`;
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  async function waitForCloseAsync(): Promise<void> {
    for (let attempt = 0; attempt < 50 && closedRequests === 0; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }

  afterEach(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });

  function mockJobRun(logFileUrl: string): void {
    mockJobRunErrorsByIdAsync.mockResolvedValue({
      id: 'job-123',
      errors: [unknownError],
      logFileUrls: [logFileUrl],
    });
  }

  it('returns the failed step errors from the downloaded log', async () => {
    mockJobRun(
      await startServerAsync((_request, response) => {
        response.end(failedLaunchLog.map(line => JSON.stringify(line)).join('\n'));
      })
    );

    await expect(
      jobRunErrors.fetchSimulatorSessionErrorsAsync(graphqlClient, 'session-123')
    ).resolves.toEqual([
      {
        errorCode: 'UNKNOWN_ERROR',
        message: expect.stringContaining('Activity not started'),
        docsUrl: null,
      },
      {
        errorCode: 'UNKNOWN_ERROR',
        message: expect.stringContaining('exited with non-zero code: 1'),
        docsUrl: null,
      },
    ]);
  });

  it('does not log the signed log URL when the download fails', async () => {
    const logFileUrl = await startServerAsync((request, response) => {
      request.socket.destroy();
      response.end();
    });
    mockJobRun(`${logFileUrl}?X-Goog-Signature=secret-signature`);

    await expect(
      jobRunErrors.fetchSimulatorSessionErrorsAsync(graphqlClient, 'session-123')
    ).resolves.toEqual([unknownError]);
    expect(JSON.stringify(jest.mocked(Log.debug).mock.calls)).not.toContain('secret-signature');
  });

  it('falls back to the job run error when the log request fails', async () => {
    mockJobRun(
      await startServerAsync((_request, response) => {
        response.statusCode = 404;
        response.end(JSON.stringify({ level: 50, msg: 'not the cause', err: { message: 'x' } }));
      })
    );

    await expect(
      jobRunErrors.fetchSimulatorSessionErrorsAsync(graphqlClient, 'session-123')
    ).resolves.toEqual([unknownError]);
  });

  it('falls back and closes the connection when the log is too large', async () => {
    mockJobRun(
      await startServerAsync((_request, response) => {
        const chunk = 'x'.repeat(64 * 1024);
        const timer = setInterval(() => response.write(chunk), 5);
        response.on('close', () => {
          clearInterval(timer);
        });
      })
    );

    await expect(
      jobRunErrors.fetchSimulatorSessionErrorsAsync(graphqlClient, 'session-123', {
        maxLogSizeBytes: 256 * 1024,
      })
    ).resolves.toEqual([unknownError]);
    await waitForCloseAsync();
    expect(closedRequests).toBe(1);
  });

  it('falls back and closes the connection when the log download stalls', async () => {
    mockJobRun(
      await startServerAsync((_request, response) => {
        response.write('{"level":30,');
      })
    );

    const startedAt = Date.now();
    await expect(
      jobRunErrors.fetchSimulatorSessionErrorsAsync(graphqlClient, 'session-123', {
        logDownloadTimeoutMs: 200,
      })
    ).resolves.toEqual([unknownError]);
    expect(Date.now() - startedAt).toBeLessThan(2_000);
    await waitForCloseAsync();
    expect(closedRequests).toBe(1);
  });

  it('stops the log download when the signal aborts', async () => {
    mockJobRun(
      await startServerAsync((_request, response) => {
        response.write('{"level":30,');
      })
    );
    const controller = new AbortController();
    setTimeout(() => {
      controller.abort();
    }, 100);

    await expect(
      jobRunErrors.fetchSimulatorSessionErrorsAsync(graphqlClient, 'session-123', {
        signal: controller.signal,
      })
    ).resolves.toEqual([unknownError]);
    await waitForCloseAsync();
    expect(closedRequests).toBe(1);
  });

  it('does not look up errors when the signal has already aborted', async () => {
    server = http.createServer();
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const controller = new AbortController();
    controller.abort();

    await expect(
      jobRunErrors.fetchSimulatorSessionErrorsAsync(graphqlClient, 'session-123', {
        signal: controller.signal,
      })
    ).resolves.toEqual([]);
    expect(mockJobRunErrorsByIdAsync).not.toHaveBeenCalled();
  });

  it('passes an abortable signal with a deadline to the errors query', async () => {
    server = http.createServer();
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    mockJobRunErrorsByIdAsync.mockImplementation(
      async (_client, _id, { signal }) =>
        await new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            reject(signal.reason);
          });
        })
    );

    await expect(
      jobRunErrors.fetchSimulatorSessionErrorsAsync(graphqlClient, 'session-123', {
        queryTimeoutMs: 100,
      })
    ).resolves.toEqual([]);
  });
});
