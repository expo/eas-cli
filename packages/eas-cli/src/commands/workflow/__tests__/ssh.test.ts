import spawnAsync from '@expo/spawn-async';
import { Config } from '@oclif/core';
import fs from 'node:fs';

import { TurtleSshSessionQuery } from '../../../graphql/queries/TurtleSshSessionQuery';
import Log from '../../../log';
import { sleepAsync } from '../../../utils/promise';
import WorkflowSsh, {
  CONNECTION_HOST_REGEX,
  CONNECTION_SECRET_REGEX,
  parseSshArgv,
  resolveSshConnectStatus,
  splitConnectionHost,
} from '../ssh';

jest.mock('@expo/spawn-async', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('../../../graphql/queries/TurtleSshSessionQuery');
jest.mock('../../../log', () => ({
  __esModule: true,
  default: { log: jest.fn(), error: jest.fn(), newLine: jest.fn() },
}));
jest.mock('../../../ora', () => ({
  ora: jest.fn(() => {
    const spinner = { start: jest.fn(), fail: jest.fn(), succeed: jest.fn(), stop: jest.fn() };
    spinner.start.mockReturnValue(spinner);
    return spinner;
  }),
}));
jest.mock('../../../utils/promise', () => ({ sleepAsync: jest.fn() }));
jest.mock('node:fs', () => {
  const actual = jest.requireActual('node:fs');
  return {
    ...actual,
    promises: { ...actual.promises, mkdtemp: jest.fn(), writeFile: jest.fn(), rm: jest.fn() },
  };
});

describe(parseSshArgv, () => {
  it('takes the first token as the resource id and the rest as the passthrough command', () => {
    expect(parseSshArgv(['job-id', 'ls', '-la'])).toEqual({
      showConnect: false,
      resourceId: 'job-id',
      command: ['ls', '-la'],
    });
  });

  it('detects --show-connect before the id and strips it', () => {
    expect(parseSshArgv(['--show-connect', 'job-id'])).toEqual({
      showConnect: true,
      resourceId: 'job-id',
      command: [],
    });
  });

  it('detects --show-connect=true before the id', () => {
    expect(parseSshArgv(['--show-connect=true', 'job-id'])).toEqual({
      showConnect: true,
      resourceId: 'job-id',
      command: [],
    });
  });

  it('leaves --show-connect after the id in the passthrough command', () => {
    expect(parseSshArgv(['job-id', '--show-connect'])).toEqual({
      showConnect: false,
      resourceId: 'job-id',
      command: ['--show-connect'],
    });
  });

  it('throws on an unknown flag before the id', () => {
    expect(() => parseSshArgv(['--show-conect', 'job-id'])).toThrow('Unknown flag');
  });

  it('reports an undefined resource id when none is given', () => {
    expect(parseSshArgv([])).toEqual({ showConnect: false, resourceId: undefined, command: [] });
    expect(parseSshArgv(['--show-connect'])).toEqual({
      showConnect: true,
      resourceId: undefined,
      command: [],
    });
  });
});

describe(resolveSshConnectStatus, () => {
  it('is unknown when the resource did not resolve', () => {
    expect(resolveSshConnectStatus(null)).toBe('unknown');
  });

  it('is not-enabled when the job did not request ssh', () => {
    expect(
      resolveSshConnectStatus({ sshRequested: false, jobCompleted: false, session: null })
    ).toBe('not-enabled');
  });

  it('is ended when ssh was requested, the job finished, and no session remains', () => {
    expect(resolveSshConnectStatus({ sshRequested: true, jobCompleted: true, session: null })).toBe(
      'ended'
    );
  });

  it('is pending when ssh was requested and the job is still running without a session', () => {
    expect(
      resolveSshConnectStatus({ sshRequested: true, jobCompleted: false, session: null })
    ).toBe('pending');
  });

  it('is ended when the session row remains but its config was cleared', () => {
    expect(
      resolveSshConnectStatus({
        sshRequested: true,
        jobCompleted: false,
        session: { connectionConfig: null },
      })
    ).toBe('ended');
  });

  it('is ready when the session has a connection config', () => {
    expect(
      resolveSshConnectStatus({
        sshRequested: true,
        jobCompleted: false,
        session: { connectionConfig: { host: 'uptermd.upterm.dev', secret: 'tok' } },
      })
    ).toBe('ready');
  });
});

describe('workflow:ssh connection validation', () => {
  describe('CONNECTION_SECRET_REGEX', () => {
    it.each(['TOKENabc123', 'sessionId:dGhpcytpcy9iYXNlNjQ9', 'a.b_c~d-e'])(
      'accepts the upterm token %s',
      token => {
        expect(CONNECTION_SECRET_REGEX.test(token)).toBe(true);
      }
    );

    it.each(['tok en', 'tok\nUser attacker', 'tok@host', 'tok"x', "tok'x", 'tok`x', ''])(
      'rejects %j so it cannot inject an ssh config directive',
      token => {
        expect(CONNECTION_SECRET_REGEX.test(token)).toBe(false);
      }
    );
  });

  describe('CONNECTION_HOST_REGEX', () => {
    it('accepts a plain hostname', () => {
      expect(CONNECTION_HOST_REGEX.test('uptermd.upterm.dev')).toBe(true);
    });

    it.each(['host name', 'host\nHostName evil', 'host@x', 'host/x', ''])('rejects %j', host => {
      expect(CONNECTION_HOST_REGEX.test(host)).toBe(false);
    });

    it('accepts a hostname with a port', () => {
      expect(CONNECTION_HOST_REGEX.test('relay.expo.dev:8022')).toBe(true);
    });
  });
});

describe(splitConnectionHost, () => {
  it('returns the host with no port for a plain hostname', () => {
    expect(splitConnectionHost('relay.expo.dev')).toEqual({ host: 'relay.expo.dev' });
  });

  it('splits a host:port into host and numeric port', () => {
    expect(splitConnectionHost('relay.expo.dev:8022')).toEqual({
      host: 'relay.expo.dev',
      port: 8022,
    });
  });
});

describe(WorkflowSsh, () => {
  const graphqlClient = {} as never;
  const mockConnectInfo = jest.mocked(TurtleSshSessionQuery.connectInfoForResourceAsync);
  const mockSpawn = jest.mocked(spawnAsync);
  const mockSleep = jest.mocked(sleepAsync);
  const mockMkdtemp = jest.mocked(fs.promises.mkdtemp);
  const mockWriteFile = jest.mocked(fs.promises.writeFile);
  const mockRm = jest.mocked(fs.promises.rm);

  let mockConfig: Config;
  let previousExitCode: typeof process.exitCode;

  const readyInfo = {
    sshRequested: true,
    jobCompleted: false,
    session: { id: 'ts-1', connectionConfig: { host: 'relay.expo.dev', secret: 'TOKENx' } },
  };
  const pendingInfo = { sshRequested: true, jobCompleted: false, session: null };
  const endedInfo = { sshRequested: true, jobCompleted: true, session: null };
  const notEnabledInfo = { sshRequested: false, jobCompleted: false, session: null };

  beforeAll(async () => {
    mockConfig = new Config({ root: __dirname });
    mockConfig.runHook = async () => ({ failures: [], successes: [] });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    previousExitCode = process.exitCode;
    process.exitCode = undefined;
    mockMkdtemp.mockResolvedValue('/tmp/eas-ssh-1' as never);
    mockWriteFile.mockResolvedValue(undefined as never);
    mockRm.mockResolvedValue(undefined as never);
    mockSpawn.mockResolvedValue({ stdout: '', stderr: '' } as never);
    mockSleep.mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.exitCode = previousExitCode;
  });

  function createCommand(argv: string[]): WorkflowSsh {
    const command = new WorkflowSsh(argv, mockConfig);
    // @ts-expect-error getContextAsync/parse are protected
    jest.spyOn(command, 'getContextAsync').mockResolvedValue({ loggedIn: { graphqlClient } });
    // @ts-expect-error parse is protected on the oclif base
    jest.spyOn(command, 'parse').mockResolvedValue({});
    return command;
  }

  it('throws when no resource id is given', async () => {
    await expect(createCommand([]).runAsync()).rejects.toThrow('Provide a workflow job');
  });

  it('reports unknown and exits 1 when the id does not resolve', async () => {
    mockConnectInfo.mockResolvedValue(null);
    await createCommand(['job-1']).runAsync();
    expect(Log.error).toHaveBeenCalledWith(expect.stringContaining('No workflow job'));
    expect(process.exitCode).toBe(1);
  });

  it('reports not-enabled and exits 1 when the job did not request ssh', async () => {
    mockConnectInfo.mockResolvedValue(notEnabledInfo as never);
    await createCommand(['job-1']).runAsync();
    expect(Log.error).toHaveBeenCalledWith(expect.stringContaining('was not enabled'));
    expect(process.exitCode).toBe(1);
  });

  it('reports ended and exits 1 when the job finished without a live session', async () => {
    mockConnectInfo.mockResolvedValue(endedInfo as never);
    await createCommand(['job-1']).runAsync();
    expect(Log.error).toHaveBeenCalledWith(expect.stringContaining('has ended'));
    expect(process.exitCode).toBe(1);
  });

  it('prints the connect command for --show-connect without spawning ssh', async () => {
    mockConnectInfo.mockResolvedValue(readyInfo as never);
    await createCommand(['--show-connect', 'job-1']).runAsync();
    expect(Log.log).toHaveBeenCalledWith(
      'ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null TOKENx@relay.expo.dev'
    );
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('writes a 0600 config and opens ssh, then removes the config dir', async () => {
    mockConnectInfo.mockResolvedValue(readyInfo as never);
    await createCommand(['job-1', 'ls', '-la']).runAsync();
    expect(mockWriteFile).toHaveBeenCalledWith(
      '/tmp/eas-ssh-1/config',
      expect.stringContaining('HostName relay.expo.dev'),
      { mode: 0o600 }
    );
    expect(mockSpawn).toHaveBeenCalledWith(
      'ssh',
      ['-F', '/tmp/eas-ssh-1/config', 'eas-workflow-ssh', 'ls', '-la'],
      { stdio: 'inherit' }
    );
    expect(mockRm).toHaveBeenCalledWith('/tmp/eas-ssh-1', { recursive: true, force: true });
  });

  it('waits for a pending session to open, then connects', async () => {
    mockConnectInfo
      .mockResolvedValueOnce(pendingInfo as never)
      .mockResolvedValue(readyInfo as never);
    await createCommand(['job-1']).runAsync();
    expect(mockSleep).toHaveBeenCalled();
    expect(mockSpawn).toHaveBeenCalled();
  });

  it('exits 1 when a pending session ends before it opens', async () => {
    mockConnectInfo
      .mockResolvedValueOnce(pendingInfo as never)
      .mockResolvedValue(endedInfo as never);
    await createCommand(['job-1']).runAsync();
    expect(mockSpawn).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it('exits 1 when waiting for the session to open times out', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
    try {
      mockConnectInfo.mockResolvedValue(pendingInfo as never);
      mockSleep.mockImplementation(async () => {
        jest.setSystemTime(Date.now() + 6 * 60 * 1000);
      });
      await createCommand(['job-1']).runAsync();
      expect(mockSpawn).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('throws on an unexpected connection host', async () => {
    mockConnectInfo.mockResolvedValue({
      sshRequested: true,
      jobCompleted: false,
      session: { connectionConfig: { host: 'bad host', secret: 'TOKENx' } },
    } as never);
    await expect(createCommand(['job-1']).runAsync()).rejects.toThrow('connection host');
  });

  it('throws on an unexpected connection token', async () => {
    mockConnectInfo.mockResolvedValue({
      sshRequested: true,
      jobCompleted: false,
      session: { connectionConfig: { host: 'relay.expo.dev', secret: 'bad token' } },
    } as never);
    await expect(createCommand(['job-1']).runAsync()).rejects.toThrow('connection token');
  });

  it('propagates the ssh exit code from the catch handler', async () => {
    const command = createCommand(['job-1']);
    // @ts-expect-error isRunningSubprocess is private
    command.isRunningSubprocess = true;
    const err = Object.assign(new Error('ssh exited'), { status: 42 });
    // @ts-expect-error catch is protected
    await command.catch(err);
    expect(process.exitCode).toBe(42);
  });

  it('reports a missing ssh client (ENOENT) from the catch handler', async () => {
    const command = createCommand(['job-1']);
    // @ts-expect-error isRunningSubprocess is private
    command.isRunningSubprocess = true;
    const err = Object.assign(new Error('spawn ssh ENOENT'), { code: 'ENOENT' });
    // @ts-expect-error catch is protected
    await command.catch(err);
    expect(process.exitCode).toBe(1);
    expect(Log.error).toHaveBeenCalledWith(expect.stringContaining('Install an OpenSSH client'));
  });

  it('delegates non-subprocess errors to the base handler', async () => {
    const command = createCommand(['job-1']);
    let threw = false;
    try {
      // @ts-expect-error catch is protected
      await command.catch(new Error('boom'));
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  it('stops the spinner and rethrows when polling fails while waiting', async () => {
    mockConnectInfo
      .mockResolvedValueOnce(pendingInfo as never)
      .mockRejectedValue(new Error('network blip'));
    await expect(createCommand(['job-1']).runAsync()).rejects.toThrow('network blip');
  });
});
