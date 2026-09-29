import { bunyan } from '@expo/logger';
import fetch from 'node-fetch';

import { Sentry } from '../../../sentry';
import { warmUpAgentDeviceIosRunnerAsync } from '../agentDeviceRunnerWarmup';

jest.mock('../../../sentry');
jest.mock('node-fetch');

const { Response } = jest.requireActual('node-fetch') as typeof import('node-fetch');

function createLoggerMock(): bunyan {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as bunyan;
}

function jsonResponse(body: unknown, status = 200): InstanceType<typeof Response> {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe(warmUpAgentDeviceIosRunnerAsync, () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('sends prepare ios-runner to the session daemon', async () => {
    const logger = createLoggerMock();
    jest.mocked(fetch).mockResolvedValue(
      jsonResponse({
        jsonrpc: '2.0',
        id: 'eas-prepare-ios-runner',
        result: { ok: true, data: { durationMs: 21815, cache: 'exact' } },
      }) as never
    );

    await warmUpAgentDeviceIosRunnerAsync({
      daemonUrl: 'http://127.0.0.1:5678',
      daemonToken: 'daemon-token',
      logger,
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = jest.mocked(fetch).mock.calls[0];
    expect(url).toBe('http://127.0.0.1:5678/rpc');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual(
      expect.objectContaining({ Authorization: 'Bearer daemon-token' })
    );
    expect(JSON.parse(init?.body as string)).toEqual({
      jsonrpc: '2.0',
      id: 'eas-prepare-ios-runner',
      method: 'agent_device.command',
      params: {
        session: 'eas-runner-warmup',
        command: 'prepare',
        positionals: ['ios-runner'],
        flags: { platform: 'ios' },
      },
    });
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('(daemon: 21815 ms, runner cache: exact)')
    );
    expect(logger.warn).not.toHaveBeenCalled();
    expect(Sentry.capture).not.toHaveBeenCalled();
  });

  it('warns and does not throw when the daemon reports an error', async () => {
    const logger = createLoggerMock();
    jest.mocked(fetch).mockResolvedValue(
      jsonResponse({
        jsonrpc: '2.0',
        id: 'eas-prepare-ios-runner',
        result: { ok: false, error: { code: 'COMMAND_FAILED', message: 'runner did not start' } },
      }) as never
    );

    await expect(
      warmUpAgentDeviceIosRunnerAsync({
        daemonUrl: 'http://127.0.0.1:5678',
        daemonToken: 'daemon-token',
        logger,
      })
    ).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledWith(
      {
        err: expect.objectContaining({ message: expect.stringContaining('runner did not start') }),
      },
      expect.stringContaining('Could not warm up the agent-device iOS runner')
    );
    expect(Sentry.capture).toHaveBeenCalledWith(
      'Could not warm up the agent-device iOS runner',
      expect.any(Error),
      expect.objectContaining({ level: 'warning' })
    );
  });

  it('warns and does not throw when the JSON-RPC call fails', async () => {
    const logger = createLoggerMock();
    jest
      .mocked(fetch)
      .mockResolvedValue(
        jsonResponse(
          { jsonrpc: '2.0', id: null, error: { code: -32601, message: 'Method not found' } },
          404
        ) as never
      );

    await warmUpAgentDeviceIosRunnerAsync({
      daemonUrl: 'http://127.0.0.1:5678',
      daemonToken: 'daemon-token',
      logger,
    });

    expect(logger.warn).toHaveBeenCalledWith(
      { err: expect.objectContaining({ message: expect.stringContaining('Method not found') }) },
      expect.any(String)
    );
  });

  it('warns and does not throw when the daemon is unreachable', async () => {
    const logger = createLoggerMock();
    jest.mocked(fetch).mockRejectedValue(new Error('connect ECONNREFUSED'));

    await expect(
      warmUpAgentDeviceIosRunnerAsync({
        daemonUrl: 'http://127.0.0.1:5678',
        daemonToken: 'daemon-token',
        logger,
      })
    ).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(Sentry.capture).toHaveBeenCalledTimes(1);
  });
});
