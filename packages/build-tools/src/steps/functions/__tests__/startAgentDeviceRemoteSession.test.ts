import { type bunyan } from '@expo/logger';
import spawn from '@expo/turtle-spawn';
import fs from 'node:fs';
import path from 'node:path';

import { Sentry } from '../../../sentry';
import { spawnDetached } from '../../utils/remoteDeviceRunSession';
import {
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
  const stopAsync = jest.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    jest.clearAllMocks();
    stopAsync.mockResolvedValue(undefined);
    jest.mocked(spawnDetached).mockReturnValue({
      pid: 1234,
      getOutput: () => '',
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
      env: expect.objectContaining({ AGENT_DEVICE_DAEMON_SERVER_MODE: 'http' }),
    });

    await handle.stopAsync();
    await expect(fs.promises.access(addCwd)).rejects.toThrow();
  });

  it('installs with npm when EAS_OVERRIDE_PACKAGE_MANAGER is npm', async () => {
    await startAgentDeviceDaemonAsync({
      packageVersion: undefined,
      env: { EAS_OVERRIDE_PACKAGE_MANAGER: 'npm' },
      logger,
    });

    expect(spawn).toHaveBeenCalledWith(
      'npm',
      ['install', '--no-audit', 'agent-device@latest'],
      expect.objectContaining({ cwd: expect.stringContaining('eas-agent-device-') })
    );
  });

  it('falls back to git clone when the published daemon is missing', async () => {
    jest.mocked(spawn).mockImplementation((async (command: string, args: string[]) => {
      if (command === 'bun' && args[0] === '--version') {
        return { stdout: '1.3.11\n' };
      }
      return { stdout: '' };
    }) as never);

    await startAgentDeviceDaemonAsync({
      packageVersion: '1.2.3',
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
      env: expect.objectContaining({ AGENT_DEVICE_DAEMON_SERVER_MODE: 'http' }),
    });
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

    await startAgentDeviceDaemonAsync({
      packageVersion: undefined,
      env: { EAS_OVERRIDE_PACKAGE_MANAGER: 'npm' },
      logger,
    });

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
