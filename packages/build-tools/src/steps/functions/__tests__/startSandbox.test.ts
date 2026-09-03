import { SystemError } from '@expo/eas-build-job';

import { createStartSandboxBuildFunction, waitForSandboxStoppedAsync } from '../startSandbox';

describe('sandbox build functions', () => {
  it('provides one long-running step', () => {
    const ctx = { job: {} } as any;
    expect(createStartSandboxBuildFunction(ctx).getFullId()).toBe('eas/start_sandbox');
  });

  it('throws a system error when the sandbox token is missing', async () => {
    const fn = createStartSandboxBuildFunction({
      job: {},
      env: {},
      mcpServerUrl: 'ws://localhost:8787',
    } as any);

    await expect(
      fn.fn!({} as any, {
        inputs: { sandbox_id: { value: 'sandbox-id' } },
        outputs: {},
        env: {},
      })
    ).rejects.toBeInstanceOf(SystemError);
  });

  it('throws a system error when the MCP server URL is missing', async () => {
    const fn = createStartSandboxBuildFunction({
      job: {},
      env: { __EAS_SANDBOX_MCP_TOKEN: 'sandbox-token' },
    } as any);

    await expect(
      fn.fn!({} as any, {
        inputs: { sandbox_id: { value: 'sandbox-id' } },
        outputs: {},
        env: {},
      })
    ).rejects.toBeInstanceOf(SystemError);
  });

  it('polls GraphQL until the sandbox is stopped', async () => {
    const results = [
      { data: { sandboxes: { byId: { status: 'RUNNING' } } } },
      { data: { sandboxes: { byId: { status: 'STOPPED' } } } },
    ];
    const query = jest.fn(() => ({ toPromise: async () => results.shift() }));
    const logger = { info: jest.fn(), warn: jest.fn() };

    await waitForSandboxStoppedAsync({ graphqlClient: { query } } as any, {
      sandboxId: 'sandbox-id',
      logger: logger as any,
      pollIntervalMs: 1,
    });

    expect(query).toHaveBeenCalledTimes(2);
    expect(logger.info).toHaveBeenLastCalledWith('Sandbox sandbox-id was stopped.');
  });

  it('fails after three consecutive GraphQL errors', async () => {
    const query = jest.fn(() => ({
      toPromise: async () => ({ error: new Error('request failed') }),
    }));
    const logger = { info: jest.fn(), warn: jest.fn() };

    await expect(
      waitForSandboxStoppedAsync({ graphqlClient: { query } } as any, {
        sandboxId: 'sandbox-id',
        logger: logger as any,
        pollIntervalMs: 1,
      })
    ).rejects.toThrow('Could not poll sandbox status after 3 consecutive attempts.');

    expect(query).toHaveBeenCalledTimes(3);
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });

  it('resets the GraphQL error count after a successful check', async () => {
    const results = [
      { error: new Error('request failed') },
      { data: { sandboxes: { byId: { status: 'RUNNING' } } } },
      { error: new Error('request failed') },
      { error: new Error('request failed') },
      { data: { sandboxes: { byId: { status: 'STOPPED' } } } },
    ];
    const query = jest.fn(() => ({ toPromise: async () => results.shift() }));
    const logger = { info: jest.fn(), warn: jest.fn() };

    await waitForSandboxStoppedAsync({ graphqlClient: { query } } as any, {
      sandboxId: 'sandbox-id',
      logger: logger as any,
      pollIntervalMs: 1,
    });

    expect(query).toHaveBeenCalledTimes(5);
  });
});
