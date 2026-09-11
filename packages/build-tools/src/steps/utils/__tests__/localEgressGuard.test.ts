import { type bunyan } from '@expo/logger';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import { IosSimulatorUtils } from '../../../utils/IosSimulatorUtils';
import { writeLocalEgressHandoffAsync } from '../localEgress';
import {
  EGRESS_GUARD_LOG_ENV,
  EGRESS_GUARD_MODE_ENV,
  GuardEventRelay,
  GuardLogTailer,
  buildGuardLaunchdEnvironment,
  installLocalEgressGuardAsync,
  parseGuardLogLine,
  resolveEgressGuardLibraryAsync,
  stopLocalEgressGuardRelaysAsync,
} from '../localEgressGuard';

jest.mock('@expo/turtle-spawn');
jest.mock('../../../utils/IosSimulatorUtils', () => ({
  IosSimulatorUtils: { setLaunchdEnvironmentAsync: jest.fn() },
}));

const mockedSetEnv = jest.mocked(IosSimulatorUtils.setLaunchdEnvironmentAsync);

function createLogger(): bunyan & { lines: { level: string; msg: string }[] } {
  const lines: { level: string; msg: string }[] = [];
  const record = (level: string) => (a: unknown, b?: unknown) =>
    lines.push({ level, msg: typeof a === 'string' ? a : String(b) });
  return { info: record('info'), warn: record('warn'), debug: record('debug'), lines } as any;
}

const handoff = { url: 'https://egress.example', token: 'pw', fingerprint: 'fp=', port: 8899 };

describe(buildGuardLaunchdEnvironment, () => {
  it('inserts the library and passes the log path and mode', () => {
    expect(
      buildGuardLaunchdEnvironment({
        libraryPath: '/w/bin/egress-guard.dylib',
        logPath: '/tmp/guard.log',
        mode: 'block',
      })
    ).toEqual({
      DYLD_INSERT_LIBRARIES: '/w/bin/egress-guard.dylib',
      [EGRESS_GUARD_LOG_ENV]: '/tmp/guard.log',
      [EGRESS_GUARD_MODE_ENV]: 'block',
    });
  });
});

describe(parseGuardLogLine, () => {
  it('parses a blocked event with callers', () => {
    expect(
      parseGuardLogLine(
        'eas-egress-guard\tMyApp\t4242\tconnect\tblocked\t93.184.216.34:443\tNetwork,CFNetwork,MyApp'
      )
    ).toEqual({
      process: 'MyApp',
      pid: 4242,
      function: 'connect',
      action: 'blocked',
      peer: '93.184.216.34:443',
      callers: ['Network', 'CFNetwork', 'MyApp'],
    });
  });

  it('parses a logged event without callers and IPv6 peers', () => {
    expect(
      parseGuardLogLine('eas-egress-guard\tdaemon\t7\tsendto\tlogged\t[2606:4700::1]:53\t')
    ).toEqual({
      process: 'daemon',
      pid: 7,
      function: 'sendto',
      action: 'logged',
      peer: '[2606:4700::1]:53',
      callers: [],
    });
  });

  it('ignores lines that are not guard events', () => {
    expect(parseGuardLogLine('')).toBeNull();
    expect(parseGuardLogLine('something else\ta\tb')).toBeNull();
    expect(
      parseGuardLogLine('eas-egress-guard\tMyApp\tnot-a-pid\tconnect\tblocked\t1.1.1.1:443\t')
    ).toBeNull();
    expect(
      parseGuardLogLine('eas-egress-guard\tMyApp\t1\tconnect\tmaybe\t1.1.1.1:443\t')
    ).toBeNull();
  });
});

describe(GuardEventRelay, () => {
  const blocked = (process: string, peer: string, pid = 1) => ({
    process,
    pid,
    function: 'connect',
    action: 'blocked' as const,
    peer,
    callers: ['Network', 'CFNetwork'],
  });

  it('logs the first sighting of a process and destination, then only counts', () => {
    const logger = createLogger();
    const relay = new GuardEventRelay(logger);
    relay.handle(blocked('MyApp', '1.1.1.1:443'));
    relay.handle(blocked('MyApp', '1.1.1.1:443', 2));
    relay.handle(blocked('MyApp', '2.2.2.2:443'));
    expect(logger.lines.map(l => l.msg)).toEqual([
      expect.stringContaining(
        'refused connect from MyApp (pid 1) to 1.1.1.1:443; callers: Network, CFNetwork'
      ),
      expect.stringContaining('refused connect from MyApp (pid 1) to 2.2.2.2:443'),
    ]);
    expect(relay.summary()).toEqual({ blocked: 3, logged: 0, distinct: 2, suppressed: 0 });
  });

  it('words observed events differently and stops logging past the limit', () => {
    const logger = createLogger();
    const relay = new GuardEventRelay(logger, /* limit */ 1);
    relay.handle({ ...blocked('MyApp', '1.1.1.1:443'), action: 'logged' });
    relay.handle({ ...blocked('MyApp', '2.2.2.2:443'), action: 'logged' });
    expect(logger.lines).toHaveLength(1);
    expect(logger.lines[0].msg).toContain('observed connect from MyApp');
    expect(relay.summary()).toEqual({ blocked: 0, logged: 2, distinct: 2, suppressed: 1 });
  });

  it('writes a summary line', () => {
    const logger = createLogger();
    const relay = new GuardEventRelay(logger);
    relay.handle(blocked('MyApp', '1.1.1.1:443'));
    relay.handle(blocked('MyApp', '1.1.1.1:443'));
    relay.handle(blocked('daemon', '3.3.3.3:443', 9));
    relay.logSummary();
    expect(logger.lines.at(-1)?.msg).toContain(
      'refused 3 connection attempt(s) to 2 distinct destination(s) from 2 process(es)'
    );
  });
});

describe(GuardLogTailer, () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'guard-tailer-'));
  });
  afterEach(async () => {
    await fs.promises.rm(dir, { recursive: true, force: true });
  });

  it('delivers whole lines as they are appended, keeps partial lines, and survives truncation', async () => {
    const file = path.join(dir, 'guard.log');
    const lines: string[] = [];
    const tailer = new GuardLogTailer({ path: file, onLine: l => lines.push(l), intervalMs: 20 });
    tailer.start();
    await sleep(50); // file does not exist yet; must not throw
    await fs.promises.writeFile(file, 'first\nsecond\npart', 'utf8');
    await sleep(80);
    expect(lines).toEqual(['first', 'second']);
    await fs.promises.appendFile(file, 'ial\n', 'utf8');
    await sleep(80);
    expect(lines).toEqual(['first', 'second', 'partial']);
    await fs.promises.writeFile(file, 'after-truncate\n', 'utf8');
    await sleep(80);
    expect(lines).toEqual(['first', 'second', 'partial', 'after-truncate']);
    await tailer.stopAsync();
    await fs.promises.appendFile(file, 'late\n', 'utf8');
    await sleep(60);
    expect(lines).not.toContain('late');
  });

  it('flushes what is already in the file when stopped', async () => {
    const file = path.join(dir, 'guard.log');
    const lines: string[] = [];
    const tailer = new GuardLogTailer({
      path: file,
      onLine: l => lines.push(l),
      intervalMs: 10_000,
    });
    tailer.start();
    await fs.promises.writeFile(file, 'only\n', 'utf8');
    await tailer.stopAsync();
    expect(lines).toEqual(['only']);
  });
});

describe(resolveEgressGuardLibraryAsync, () => {
  it('returns null when the library is not built', async () => {
    await expect(
      resolveEgressGuardLibraryAsync(path.join(os.tmpdir(), 'no-such-dir'))
    ).resolves.toBeNull();
  });

  it('returns the packaged path when present', async () => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'guard-bin-'));
    const lib = path.join(dir, 'egress-guard.dylib');
    await fs.promises.writeFile(lib, '');
    await expect(resolveEgressGuardLibraryAsync(dir)).resolves.toBe(lib);
    await fs.promises.rm(dir, { recursive: true, force: true });
  });
});

describe(installLocalEgressGuardAsync, () => {
  let dir: string;
  let logger: ReturnType<typeof createLogger>;
  beforeEach(async () => {
    mockedSetEnv.mockReset();
    mockedSetEnv.mockResolvedValue(undefined);
    dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'guard-install-'));
    logger = createLogger();
  });
  afterEach(async () => {
    await stopLocalEgressGuardRelaysAsync(logger);
    await fs.promises.rm(dir, { recursive: true, force: true });
  });

  it('does nothing without a local egress session', async () => {
    await expect(
      installLocalEgressGuardAsync({
        udid: 'u' as any,
        env: process.env,
        logger,
        handoffPath: path.join(dir, 'missing.json'),
        libraryPath: path.join(dir, 'egress-guard.dylib'),
        logPath: path.join(dir, 'guard.log'),
      })
    ).resolves.toBe(false);
    expect(mockedSetEnv).not.toHaveBeenCalled();
  });

  it('warns and continues when the library is not available', async () => {
    const handoffPath = path.join(dir, 'handoff.json');
    await writeLocalEgressHandoffAsync(handoff, handoffPath);
    await expect(
      installLocalEgressGuardAsync({
        udid: 'u' as any,
        env: process.env,
        logger,
        handoffPath,
        libraryPath: null,
        logPath: path.join(dir, 'guard.log'),
      })
    ).resolves.toBe(false);
    expect(mockedSetEnv).not.toHaveBeenCalled();
    expect(logger.lines.some(l => l.level === 'warn' && /not available/.test(l.msg))).toBe(true);
  });

  it('sets the launchd environment, creates the log file, and relays events into the session log', async () => {
    const handoffPath = path.join(dir, 'handoff.json');
    await writeLocalEgressHandoffAsync(handoff, handoffPath);
    const libraryPath = path.join(dir, 'egress-guard.dylib');
    await fs.promises.writeFile(libraryPath, '');
    const logPath = path.join(dir, 'guard.log');

    await expect(
      installLocalEgressGuardAsync({
        udid: 'u' as any,
        env: process.env,
        logger,
        handoffPath,
        libraryPath,
        logPath,
        mode: 'block',
        tailIntervalMs: 20,
      })
    ).resolves.toBe(true);

    expect(mockedSetEnv).toHaveBeenCalledWith({
      udid: 'u',
      env: process.env,
      variables: buildGuardLaunchdEnvironment({ libraryPath, logPath, mode: 'block' }),
    });
    expect(fs.existsSync(logPath)).toBe(true);
    expect(logger.lines.some(l => /guard installed/.test(l.msg) && /block/.test(l.msg))).toBe(true);

    await fs.promises.appendFile(
      logPath,
      'eas-egress-guard\tMyApp\t4242\tconnect\tblocked\t1.1.1.1:443\tNetwork\n'
    );
    await sleep(80);
    expect(
      logger.lines.some(l =>
        /refused connect from MyApp \(pid 4242\) to 1\.1\.1\.1:443/.test(l.msg)
      )
    ).toBe(true);

    await stopLocalEgressGuardRelaysAsync(logger);
    expect(logger.lines.at(-1)?.msg).toContain('refused 1 connection attempt(s)');
  });

  it('warns and continues when launchctl fails', async () => {
    const handoffPath = path.join(dir, 'handoff.json');
    await writeLocalEgressHandoffAsync(handoff, handoffPath);
    const libraryPath = path.join(dir, 'egress-guard.dylib');
    await fs.promises.writeFile(libraryPath, '');
    mockedSetEnv.mockRejectedValue(new Error('launchctl failed'));

    await expect(
      installLocalEgressGuardAsync({
        udid: 'u' as any,
        env: process.env,
        logger,
        handoffPath,
        libraryPath,
        logPath: path.join(dir, 'guard.log'),
      })
    ).resolves.toBe(false);
    expect(logger.lines.some(l => l.level === 'warn' && /could not install/.test(l.msg))).toBe(
      true
    );
  });
});
