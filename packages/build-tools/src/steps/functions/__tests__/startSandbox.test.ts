import { EnvironmentSecretType } from '@expo/eas-build-job';
import fetch from 'node-fetch';

import * as sandboxDaemon from '../../utils/sandboxDaemon';
import { createStartSandboxBuildFunction } from '../startSandbox';

const { Response, AbortError } = jest.requireActual('node-fetch') as typeof import('node-fetch');
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
  expoApiV2BaseUrl: 'https://api.expo.test/v2/',
  mcpServerUrl: 'ws://localhost:8787',
};
const inputs = { sandbox_id: { value: 'sandbox-id' } };

describe('sandbox startup', () => {
  afterEach(() => jest.restoreAllMocks());

  it('uses the worker token and excludes credentials from command environments', async () => {
    const error = new Error('stop after checking options');
    const start = jest.spyOn(sandboxDaemon, 'startSandboxDaemonAsync').mockRejectedValue(error);
    const fn = createStartSandboxBuildFunction(context as any);
    await expect(
      fn.fn!({ logger: {} } as any, {
        inputs,
        outputs: {},
        env: {
          KEEP: 'value',
          EXPO_TOKEN: 'expo-token',
          EAS_SANDBOX_WORKER_TOKEN: 'worker-token',
          __EAS_SANDBOX_MCP_TOKEN: 'legacy-token',
        },
      })
    ).rejects.toBe(error);
    expect(start.mock.calls[0][0]).toMatchObject({
      credential: 'worker-token',
      env: { KEEP: 'value' },
    });
    expect(start.mock.calls[0][0].env).toEqual({ KEEP: 'value' });
  });

  it('does not mark ready after cancellation during startup and stops the daemon', async () => {
    const controller = new AbortController();
    const stopAsync = jest.fn(async () => {});
    jest.spyOn(sandboxDaemon, 'startSandboxDaemonAsync').mockImplementation(async () => {
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

  it('authenticates readiness with the worker token and aborts its request when canceled', async () => {
    const controller = new AbortController();
    const stopAsync = jest.fn(async () => {});
    jest
      .spyOn(sandboxDaemon, 'startSandboxDaemonAsync')
      .mockResolvedValue({ ready: Promise.resolve(), stopAsync });
    let started!: () => void;
    const requestStarted = new Promise<void>(resolve => {
      started = resolve;
    });
    jest.mocked(fetch).mockImplementationOnce(async (_url, init) => {
      expect(init?.headers).toMatchObject({ 'expo-sandbox-worker-token': 'worker-token' });
      expect(init?.headers).not.toHaveProperty('Authorization');
      return await new Promise((_resolve, reject) => {
        init!.signal!.addEventListener('abort', () => reject(new AbortError('Aborted')));
        started();
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
    await requestStarted;
    controller.abort();
    await rejected;
    expect(stopAsync).toHaveBeenCalledTimes(1);
  });

  it('stops the daemon when readiness fails', async () => {
    const stopAsync = jest.fn(async () => {});
    jest
      .spyOn(sandboxDaemon, 'startSandboxDaemonAsync')
      .mockResolvedValue({ ready: Promise.resolve(), stopAsync });
    jest
      .mocked(fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ errors: [{ message: 'Sandbox has stopped.' }] }), {
          status: 400,
        })
      );
    const fn = createStartSandboxBuildFunction(context as any);
    await expect(fn.fn!({ logger: {} } as any, { inputs, outputs: {}, env: {} })).rejects.toThrow(
      'Sandbox has stopped.'
    );
    expect(stopAsync).toHaveBeenCalledTimes(1);
  });

  it.each([
    { overrides: { job: {} }, message: 'Sandbox worker token is missing.' },
    { overrides: { mcpServerUrl: undefined }, message: 'MCP server URL is required' },
    { overrides: { expoApiV2BaseUrl: undefined }, message: 'Sandbox worker API URL is missing.' },
  ])('rejects missing configuration: $message', async ({ overrides, message }) => {
    const fn = createStartSandboxBuildFunction({ ...context, ...overrides } as any);
    await expect(
      fn.fn!({} as any, { inputs, outputs: {}, env: { __EAS_SANDBOX_MCP_TOKEN: 'legacy-token' } })
    ).rejects.toThrow(message);
  });
});
