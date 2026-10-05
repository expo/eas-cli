import { type bunyan } from '@expo/logger';
import spawn from '@expo/turtle-spawn';
import fs from 'node:fs';
import path from 'node:path';

import { Sentry } from '../../../sentry';
import { spawnDetached } from '../../utils/remoteDeviceRunSession';
import {
  type AgentDeviceDaemonPolicy,
  startAgentDeviceDaemonAsync,
  stopAgentDeviceEventCollectionSafelyAsync,
} from '../startAgentDeviceRemoteSession';

jest.mock('../../../sentry');
jest.mock('@expo/turtle-spawn', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('../../utils/remoteDeviceRunSession', () => ({
  ...jest.requireActual('../../utils/remoteDeviceRunSession'),
  spawnDetached: jest.fn(),
}));

const logger = { info: jest.fn(), warn: jest.fn() } as unknown as bunyan;

async function writeDaemonEntry(cwd: string): Promise<string> {
  const daemonPath = path.join(
    cwd,
    'node_modules',
    'agent-device',
    'dist',
    'src',
    'internal',
    'daemon.js'
  );
  await fs.promises.mkdir(path.dirname(daemonPath), { recursive: true });
  await fs.promises.writeFile(daemonPath, '');
  return daemonPath;
}

describe(stopAgentDeviceEventCollectionSafelyAsync, () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('reports an unexpected stop failure without rejecting', async () => {
    const error = new Error('stop failed');

    await expect(
      stopAgentDeviceEventCollectionSafelyAsync({
        eventCollection: { stopAsync: jest.fn().mockRejectedValue(error) },
        deviceRunSessionId: 'session-id',
        logger,
      })
    ).resolves.toBeUndefined();

    expect(Sentry.capture).toHaveBeenCalledWith(
      'Could not finish agent-device session event collection',
      error,
      {
        level: 'warning',
        tags: { phase: 'agent-device-event-collection', operation: 'stop' },
        extras: { deviceRunSessionId: 'session-id' },
      }
    );
    expect(logger.warn).toHaveBeenCalledWith(
      { err: error },
      'Could not finish agent-device session event collection.'
    );
  });
});

describe(startAgentDeviceDaemonAsync, () => {
  const policy: AgentDeviceDaemonPolicy = {
    version: 1,
    devices: { allow: [{ udid: 'SIMULATOR-UDID' }] },
    commands: { deny: ['boot', 'shutdown'] },
    capabilities: { deny: ['device-shutdown'] },
  };
  const waitForPolicyAsync = jest.fn(async () => policy);

  /** Returns the policy file of the launched daemon, after it checks the file's content. */
  async function expectLaunchedWithPolicyAsync(): Promise<string> {
    const policyPath = jest.mocked(spawnDetached).mock.calls[0][0].env
      .AGENT_DEVICE_DAEMON_POLICY as string;
    expect(JSON.parse(await fs.promises.readFile(policyPath, 'utf8'))).toEqual(policy);
    return policyPath;
  }
  const stopAsync = jest.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    jest.clearAllMocks();
    stopAsync.mockResolvedValue(undefined);
    jest.mocked(spawnDetached).mockReturnValue({
      pid: 1234,
      getOutput: () => '',
      getExitError: () => undefined,
      stopAsync,
    });
    jest.mocked(spawn).mockImplementation((async (
      command: string,
      args: string[],
      options?: { cwd?: string }
    ) => {
      if (command === 'bun' && args[0] === '--version') {
        return { stdout: '1.3.11\n' };
      }
      if (typeof options?.cwd === 'string' && command !== 'git') {
        await writeDaemonEntry(options.cwd);
      }
      return { stdout: '' };
    }) as never);
  });

  it('installs with bun add by default and launches the published daemon', async () => {
    const handle = await startAgentDeviceDaemonAsync({
      packageVersion: '1.2.3',
      waitForPolicyAsync,
      env: {},
      logger,
    });

    expect(spawn).toHaveBeenCalledWith(
      'bun',
      ['add', 'agent-device@1.2.3'],
      expect.objectContaining({ cwd: expect.stringContaining('eas-agent-device-') })
    );
    const addCwd = jest.mocked(spawn).mock.calls[0][2]?.cwd as string;
    expect(spawnDetached).toHaveBeenCalledWith({
      command: 'node',
      args: [path.join(addCwd, 'node_modules/agent-device/dist/src/internal/daemon.js')],
      env: expect.objectContaining({
        AGENT_DEVICE_DAEMON_SERVER_MODE: 'http',
        AGENT_DEVICE_DAEMON_IDLE_TIMEOUT_MS: '0',
        AGENT_DEVICE_IOS_RUNNER_IDLE_STOP_MS: '0',
        AGENT_DEVICE_SESSION_IDLE_TIMEOUT_MS: '0',
        AGENT_DEVICE_DAEMON_POLICY: expect.any(String),
      }),
    });
    const policyPath = await expectLaunchedWithPolicyAsync();

    await handle.stopAsync();
    expect(stopAsync).toHaveBeenCalledTimes(1);
    await expect(fs.promises.access(addCwd)).rejects.toThrow();
    await expect(fs.promises.access(path.dirname(policyPath))).rejects.toThrow();
  });

  it('waits for the policy only after the install', async () => {
    const order: string[] = [];
    const baseSpawn = jest.mocked(spawn).getMockImplementation()!;
    jest.mocked(spawn).mockImplementation(((...args: Parameters<typeof baseSpawn>) => {
      order.push('install');
      return baseSpawn(...args);
    }) as never);

    const handle = await startAgentDeviceDaemonAsync({
      packageVersion: '1.2.3',
      waitForPolicyAsync: async () => {
        order.push('policy');
        return policy;
      },
      env: {},
      logger,
    });

    expect(order).toEqual(['install', 'policy']);
    await handle.stopAsync();
  });

  it('removes its files and launches nothing when the policy wait fails', async () => {
    const failure = new Error('boot failed');

    await expect(
      startAgentDeviceDaemonAsync({
        packageVersion: '1.2.3',
        waitForPolicyAsync: async () => {
          throw failure;
        },
        env: {},
        logger,
      })
    ).rejects.toBe(failure);

    const addCwd = jest.mocked(spawn).mock.calls[0][2]?.cwd as string;
    await expect(fs.promises.access(addCwd)).rejects.toThrow();
    expect(spawnDetached).not.toHaveBeenCalled();
    // A failed policy wait is not an install problem, so there is no git fallback.
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(Sentry.capture).not.toHaveBeenCalled();
  });

  it('installs with npm when EAS_OVERRIDE_PACKAGE_MANAGER is npm', async () => {
    const handle = await startAgentDeviceDaemonAsync({
      packageVersion: undefined,
      waitForPolicyAsync,
      env: { EAS_OVERRIDE_PACKAGE_MANAGER: 'npm' },
      logger,
    });

    expect(spawn).toHaveBeenCalledWith(
      'npm',
      ['install', '--no-audit', 'agent-device@latest'],
      expect.objectContaining({ cwd: expect.stringContaining('eas-agent-device-') })
    );
    await handle.stopAsync();
  });

  it('kills the install and does not fall back to git when aborted', async () => {
    jest.mocked(spawn).mockImplementation(
      ((_command: string, _args: string[], options?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          options!.signal!.addEventListener('abort', () => reject(options!.signal!.reason));
        })) as never
    );
    const controller = new AbortController();
    const failure = new Error('app install failed');

    const daemon = startAgentDeviceDaemonAsync({
      packageVersion: '1.2.3',
      waitForPolicyAsync,
      env: {},
      logger,
      signal: controller.signal,
    });
    await new Promise(resolve => setImmediate(resolve));
    controller.abort(failure);

    await expect(daemon).rejects.toBe(failure);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn).toHaveBeenCalledWith(
      'bun',
      ['add', 'agent-device@1.2.3'],
      expect.objectContaining({ signal: controller.signal })
    );
    expect(spawnDetached).not.toHaveBeenCalled();
    expect(Sentry.capture).not.toHaveBeenCalled();
  });

  it('falls back to git clone when the published daemon is missing', async () => {
    jest.mocked(spawn).mockImplementation((async (command: string, args: string[]) => {
      if (command === 'bun' && args[0] === '--version') {
        return { stdout: '1.3.11\n' };
      }
      return { stdout: '' };
    }) as never);

    const handle = await startAgentDeviceDaemonAsync({
      packageVersion: '1.2.3',
      waitForPolicyAsync,
      env: {},
      logger,
    });

    expect(spawn).toHaveBeenCalledWith(
      'git',
      [
        'clone',
        '--depth',
        '1',
        '--branch',
        'v1.2.3',
        'https://github.com/callstack/agent-device.git',
        '/tmp/agent-device-src',
      ],
      expect.objectContaining({ env: {}, logger })
    );
    expect(spawn).toHaveBeenCalledWith(
      'bun',
      ['install', '--production'],
      expect.objectContaining({ cwd: '/tmp/agent-device-src' })
    );
    expect(spawnDetached).toHaveBeenCalledWith({
      command: 'bun',
      args: ['run', 'src/daemon.ts'],
      cwd: '/tmp/agent-device-src',
      env: expect.objectContaining({
        AGENT_DEVICE_DAEMON_SERVER_MODE: 'http',
        AGENT_DEVICE_DAEMON_IDLE_TIMEOUT_MS: '0',
        AGENT_DEVICE_IOS_RUNNER_IDLE_STOP_MS: '0',
        AGENT_DEVICE_SESSION_IDLE_TIMEOUT_MS: '0',
        AGENT_DEVICE_DAEMON_POLICY: expect.any(String),
      }),
    });
    const policyPath = await expectLaunchedWithPolicyAsync();
    await handle.stopAsync();
    await expect(fs.promises.access(path.dirname(policyPath))).rejects.toThrow();
    expect(Sentry.capture).toHaveBeenCalledWith(
      'Failed to start agent-device daemon from the configured package manager; falling back to git clone',
      expect.any(Error),
      expect.objectContaining({
        extras: expect.objectContaining({
          packageSpec: 'agent-device@1.2.3',
          packageManager: 'bun',
          bunVersion: '1.3.11',
        }),
      })
    );
  });

  it('clones latest and reports unknown bun when diagnostics fail', async () => {
    jest.mocked(spawn).mockImplementation((async (command: string, args: string[]) => {
      if (command === 'bun' && args[0] === '--version') {
        throw new Error('bun missing');
      }
      return { stdout: '' };
    }) as never);

    const handle = await startAgentDeviceDaemonAsync({
      packageVersion: undefined,
      waitForPolicyAsync,
      env: { EAS_OVERRIDE_PACKAGE_MANAGER: 'npm' },
      logger,
    });
    await handle.stopAsync();

    expect(spawn).toHaveBeenCalledWith(
      'git',
      [
        'clone',
        '--depth',
        '1',
        'https://github.com/callstack/agent-device.git',
        '/tmp/agent-device-src',
      ],
      expect.objectContaining({ logger })
    );
    expect(spawn).toHaveBeenCalledWith(
      'npm',
      ['install', '--no-audit', '--omit=dev'],
      expect.objectContaining({ cwd: '/tmp/agent-device-src' })
    );
    expect(Sentry.capture).toHaveBeenCalledWith(
      'Failed to start agent-device daemon from the configured package manager; falling back to git clone',
      expect.any(Error),
      expect.objectContaining({
        extras: expect.objectContaining({
          packageVersion: 'latest',
          packageManager: 'npm',
          bunVersion: 'unknown',
        }),
      })
    );
  });
});
