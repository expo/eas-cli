import { EnvironmentSecretType, SystemError, UserError } from '@expo/eas-build-job';
import fetch from 'node-fetch';

import * as sandboxDaemon from '../../utils/sandboxDaemon';
import { SandboxWorkerApi } from '../../utils/sandboxWorkerApi';
import { createStartSandboxBuildFunction } from '../startSandbox';

const { AbortError, Response } = jest.requireActual('node-fetch') as typeof import('node-fetch');

const context = {
  job: {
    secrets: {
      environmentSecrets: [
        {
          name: 'EAS_SANDBOX_WORKER_TOKEN',
          type: EnvironmentSecretType.STRING,
          value: 'worker-token',
        },
      ],
    },
  },
  env: {},
  expoApiV2BaseUrl: 'https://api.expo.test/v2/',
  mcpServerUrl: 'ws://localhost:8787',
};
const inputs = { sandbox_id: { value: 'sandbox-id' } };

describe('sandbox build functions', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each([
    { completion: 'duration', duration: 0.02 },
    { completion: 'cancellation', duration: 60 },
    { completion: 'duration', duration: 0.0001 },
  ])(
    'stops after $completion with $duration seconds only after readiness',
    async ({ completion, duration }) => {
      const controller = new AbortController();
      let ready!: () => void;
      const stopAsync = jest.fn(async () => {});
      jest.spyOn(sandboxDaemon, 'startSandboxDaemonAsync').mockResolvedValue({
        ready: new Promise<void>(resolve => {
          ready = resolve;
        }),
        stopAsync,
      });
      const markReady = jest
        .spyOn(SandboxWorkerApi.prototype, 'markReadyAsync')
        .mockResolvedValue(undefined);
      const logger = { info: jest.fn(), child: jest.fn() };
      logger.child.mockReturnValue(logger);
      const fn = createStartSandboxBuildFunction(context as any);
      const pending = fn.fn!({ logger } as any, {
        inputs: { ...inputs, max_duration_seconds: { value: duration } },
        outputs: {},
        env: {},
        signal: controller.signal,
      });
      await new Promise(resolve => setTimeout(resolve, 40));
      expect(markReady).not.toHaveBeenCalled();
      expect(stopAsync).not.toHaveBeenCalled();
      ready();
      if (completion === 'cancellation') {
        await new Promise(resolve => setImmediate(resolve));
        expect(stopAsync).not.toHaveBeenCalled();
        controller.abort();
      }
      await pending;
      expect(markReady).toHaveBeenCalledTimes(1);
      expect(stopAsync).toHaveBeenCalledTimes(1);
      const timeoutMessage = `Sandbox reached its maximum runtime of ${duration} seconds. Stopping.`;
      if (completion === 'duration') {
        expect(logger.info).toHaveBeenCalledWith(timeoutMessage);
      } else {
        expect(logger.info).not.toHaveBeenCalledWith(timeoutMessage);
      }
    }
  );

  it.each([0, -1, Infinity, NaN])(
    'rejects invalid maximum duration %s before starting the daemon',
    async duration => {
      const start = jest.spyOn(sandboxDaemon, 'startSandboxDaemonAsync');
      const fn = createStartSandboxBuildFunction(context as any);
      const result = fn.fn!({} as any, {
        inputs: { ...inputs, max_duration_seconds: { value: duration } },
        outputs: {},
        env: {},
      });
      await expect(result).rejects.toBeInstanceOf(UserError);
      await expect(result).rejects.toThrow(
        `Invalid sandbox maximum duration: ${duration}. Provide a finite number greater than zero, or omit max_duration_seconds.`
      );
      expect(start).not.toHaveBeenCalled();
    }
  );

  it('connects with the worker token from the job secrets, which the step env does not have', async () => {
    const env = { PREPARED_BY_EARLIER_STEP: 'value' };
    const startupError = new Error('stop after checking options');
    const start = jest
      .spyOn(sandboxDaemon, 'startSandboxDaemonAsync')
      .mockRejectedValue(startupError);
    const fn = createStartSandboxBuildFunction(context as any);

    await expect(fn.fn!({ logger: {} } as any, { inputs, outputs: {}, env })).rejects.toBe(
      startupError
    );
    expect(start.mock.calls[0][0]).toMatchObject({ credential: 'worker-token', env });
  });

  it('does not mark the sandbox ready if startup was canceled', async () => {
    const controller = new AbortController();
    const stopAsync = jest.fn(async () => {});
    jest.spyOn(sandboxDaemon, 'startSandboxDaemonAsync').mockImplementation(async options => {
      expect(options.signal).toBe(controller.signal);
      controller.abort();
      return { ready: Promise.resolve(), stopAsync };
    });
    const fn = createStartSandboxBuildFunction(context as any);

    await expect(
      fn.fn!({ logger: {} } as any, { inputs, outputs: {}, env: {}, signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetch).not.toHaveBeenCalled();
    expect(stopAsync).toHaveBeenCalledTimes(1);
  });

  it('marks the sandbox ready with only the worker token and aborts the request when canceled', async () => {
    const controller = new AbortController();
    const stopAsync = jest.fn(async () => {});
    jest
      .spyOn(sandboxDaemon, 'startSandboxDaemonAsync')
      .mockResolvedValue({ ready: Promise.resolve(), stopAsync });
    let requestStarted!: () => void;
    const started = new Promise<void>(resolve => {
      requestStarted = resolve;
    });
    jest.mocked(fetch).mockImplementationOnce(async (url, init) => {
      expect(url).toBe('https://api.expo.test/v2/sandbox-worker/ready');
      expect(init?.headers).toEqual({ 'expo-sandbox-worker-token': 'worker-token' });
      return await new Promise((_resolve, reject) => {
        init!.signal!.addEventListener('abort', () => reject(new AbortError('Aborted')));
        requestStarted();
      });
    });
    const fn = createStartSandboxBuildFunction(context as any);
    const pending = fn.fn!({ logger: {} } as any, {
      inputs,
      outputs: {},
      env: {},
      signal: controller.signal,
    });
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });

    await started;
    controller.abort();
    await rejected;
    expect(stopAsync).toHaveBeenCalledTimes(1);
  });

  it('throws a system error and stops the daemon when readiness fails', async () => {
    const stopAsync = jest.fn(async () => {});
    jest
      .spyOn(sandboxDaemon, 'startSandboxDaemonAsync')
      .mockResolvedValue({ ready: Promise.resolve(), stopAsync });
    jest.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ errors: [{ message: 'Sandbox has stopped.' }] }), {
        status: 400,
      })
    );
    const fn = createStartSandboxBuildFunction(context as any);

    const result = fn.fn!({ logger: {} } as any, { inputs, outputs: {}, env: {} });

    await expect(result).rejects.toBeInstanceOf(SystemError);
    await expect(result).rejects.toMatchObject({
      message: 'Failed to mark sandbox sandbox-id as ready.',
      cause: expect.objectContaining({ status: 400 }),
    });
    expect(stopAsync).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      missing: 'the sandbox worker token',
      overrides: { job: {} },
      message: 'This sandbox job has no EAS_SANDBOX_WORKER_TOKEN secret.',
    },
    {
      missing: 'the MCP server URL',
      overrides: { mcpServerUrl: undefined },
      message: 'MCP server URL is required to start the sandbox daemon.',
    },
    {
      missing: 'the API server URL',
      overrides: { expoApiV2BaseUrl: undefined },
      message: 'The API server URL is not set',
    },
  ])('throws a system error without $missing', async ({ overrides, message }) => {
    const start = jest.spyOn(sandboxDaemon, 'startSandboxDaemonAsync');
    const fn = createStartSandboxBuildFunction({ ...context, ...overrides } as any);

    const result = fn.fn!({} as any, { inputs, outputs: {}, env: {} });

    await expect(result).rejects.toBeInstanceOf(SystemError);
    await expect(result).rejects.toThrow(message);
    expect(start).not.toHaveBeenCalled();
  });
});
