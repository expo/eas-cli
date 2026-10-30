import { Config } from '@oclif/core';

import { DeviceRunSessionStatus } from '../../../graphql/generated';
import Log from '../../../log';
import {
  createControlConnectionIdentityAsync,
  inspectControlConnectionAsync,
  openControlConnectionAsync,
} from '../../../simulator/controlConnection';
import { ControlConnectionInfo } from '../../../simulator/controlConnectionProtocol';
import { loadControlSessionAsync } from '../../../simulator/controlSession';
import { EAS_SIMULATOR_SESSION_ID, loadSimulatorEnvAsync } from '../../../simulator/env';
import { printJsonOnlyOutput } from '../../../utils/json';
import SimulatorControlConnection from '../control/connection';

jest.mock('../../../simulator/controlConnection');
jest.mock('../../../simulator/controlSession');
jest.mock('../../../simulator/env', () => ({
  ...jest.requireActual('../../../simulator/env'),
  loadSimulatorEnvAsync: jest.fn(),
}));
jest.mock('../../../utils/json');
jest.mock('../../../log');

describe('simulator:control:connection', () => {
  const config = new Config({ root: __dirname });
  config.runHook = async () => ({ failures: [], successes: [] });
  const identity = {
    root: '/private/ipc',
    socketPath: '/private/ipc/socket',
    scope: 'fixture',
    credentialHash: '0'.repeat(64),
  };
  const info: ControlConnectionInfo = {
    version: 3,
    pid: 123,
    session: {
      id: 'session-one',
      name: null,
      project: '@fixture/app',
      status: DeviceRunSessionStatus.InProgress,
      device: { udid: 'device-one', name: 'Fixture phone' },
    },
    busy: false,
    idleTimeoutMs: 120_000,
    idleDeadline: null,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(createControlConnectionIdentityAsync).mockResolvedValue(identity);
    jest.mocked(inspectControlConnectionAsync).mockResolvedValue(null);
    jest.mocked(loadSimulatorEnvAsync).mockResolvedValue();
  });

  function command(args: string[]): SimulatorControlConnection {
    const command = new SimulatorControlConnection(args, config);
    const context = {
      projectDir: '/project',
      loggedIn: {
        graphqlClient: {},
        authenticationInfo: { accessToken: 'credential-fixture', sessionSecret: null },
      },
    };
    // @ts-expect-error getContextAsync is protected
    jest.spyOn(command, 'getContextAsync').mockResolvedValue(context);
    return command;
  }

  it('opens a connection with an idle timeout in seconds', async () => {
    jest.mocked(openControlConnectionAsync).mockImplementationOnce(async (_identity, load) => {
      await load();
      return info;
    });
    await command(['open', '--id', 'session-one', '--idle-timeout', '300', '--json']).runAsync();
    expect(openControlConnectionAsync).toHaveBeenCalledWith(
      identity,
      expect.any(Function),
      300_000
    );
    expect(inspectControlConnectionAsync).not.toHaveBeenCalled();
    expect(loadControlSessionAsync).toHaveBeenCalledWith({}, 'session-one');
  });

  it('requires a session ID when none is saved', async () => {
    const previous = process.env[EAS_SIMULATOR_SESSION_ID];
    delete process.env[EAS_SIMULATOR_SESSION_ID];
    try {
      await expect(command(['status']).runAsync()).rejects.toThrow('No simulator session ID');
      expect(createControlConnectionIdentityAsync).not.toHaveBeenCalled();
    } finally {
      if (previous !== undefined) {
        process.env[EAS_SIMULATOR_SESSION_ID] = previous;
      }
    }
  });

  it('prints a useful message when status finds no connection', async () => {
    await command(['status', '--id', 'session-one']).runAsync();
    expect(Log.log).toHaveBeenCalledWith(
      'No control connection is open. Regular control commands are available.'
    );
  });

  it.each([true, false])('prints connection details with busy=%s', async busy => {
    jest.mocked(inspectControlConnectionAsync).mockResolvedValueOnce({
      ...info,
      busy,
      idleDeadline: Date.now() + 30_000,
      session: { ...info.session, device: { udid: 'device-one' } },
    });
    await command(['status', '--id', 'session-one']).runAsync();
    expect(Log.log).toHaveBeenCalledWith('iOS Simulator · session-one');
    expect(Log.log).toHaveBeenCalledWith(
      expect.stringContaining(`Control connection ${busy ? 'busy' : 'ready'}`)
    );
    expect(Log.log).toHaveBeenCalledWith(expect.stringMatching(/^Closes in /));
  });

  it('acknowledges closing an existing connection in JSON and text', async () => {
    jest.mocked(inspectControlConnectionAsync).mockResolvedValue(info);
    await command(['close', '--id', 'session-one', '--json']).runAsync();
    expect(printJsonOnlyOutput).toHaveBeenCalledWith({
      connected: false,
      id: 'session-one',
      connection: null,
    });
    await command(['close', '--id', 'session-one']).runAsync();
    expect(Log.succeed).toHaveBeenCalledWith(
      'Control connection closing. The simulator session continues.'
    );
  });

  it('returns JSON for a missing connection without opening one', async () => {
    await command(['status', '--id', 'session-one', '--json']).runAsync();
    expect(inspectControlConnectionAsync).toHaveBeenCalledWith(identity, { operation: 'status' });
    expect(openControlConnectionAsync).not.toHaveBeenCalled();
    expect(printJsonOnlyOutput).toHaveBeenCalledWith({
      connected: false,
      id: 'session-one',
      connection: null,
    });
  });

  it('closing an absent connection succeeds without stopping a simulator session', async () => {
    await command(['close', '--id', 'session-one']).runAsync();
    expect(inspectControlConnectionAsync).toHaveBeenCalledWith(identity, { operation: 'close' });
    expect(Log.succeed).toHaveBeenCalledWith('No control connection is open.');
    expect(openControlConnectionAsync).not.toHaveBeenCalled();
  });

  it.each(['status', 'close'])('rejects idle-timeout for %s', async operation => {
    await expect(command([operation, '--idle-timeout', '300']).runAsync()).rejects.toThrow(
      'only to connection open'
    );
    expect(createControlConnectionIdentityAsync).not.toHaveBeenCalled();
  });

  it.each(['', '0', '-1', 'invalid', '5m', '0.5', '86401'])(
    'rejects idle timeout %j before connection setup',
    async duration => {
      await expect(
        command(['open', '--id', 'session-one', '--idle-timeout', duration]).runAsync()
      ).rejects.toThrow('--idle-timeout');
      expect(openControlConnectionAsync).not.toHaveBeenCalled();
    }
  );

  it('rejects an empty id before loading account state', async () => {
    await expect(command(['open', '--id=']).runAsync()).rejects.toThrow('--id needs');
    expect(createControlConnectionIdentityAsync).not.toHaveBeenCalled();
  });

  it('accepts the session saved in the project environment', async () => {
    const previous = process.env[EAS_SIMULATOR_SESSION_ID];
    process.env[EAS_SIMULATOR_SESSION_ID] = 'saved-session';
    try {
      await command(['status']).runAsync();
      expect(createControlConnectionIdentityAsync).toHaveBeenCalledWith(
        'saved-session',
        '/project',
        expect.any(Object)
      );
    } finally {
      if (previous === undefined) {
        delete process.env[EAS_SIMULATOR_SESSION_ID];
      } else {
        process.env[EAS_SIMULATOR_SESSION_ID] = previous;
      }
    }
  });
});
