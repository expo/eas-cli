/**
 * End-to-end test of the local egress guard against a real iOS Simulator.
 * Needs Xcode with a simulator runtime and network access. Opt in with
 * EAS_LOCAL_EGRESS_E2E=1; the test-egress-guard EAS workflow runs it on macOS.
 */
import { type bunyan } from '@expo/logger';
import spawn from '@expo/turtle-spawn';
import dgram from 'node:dgram';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import { IosSimulatorUtils, type IosSimulatorUuid } from '../../../utils/IosSimulatorUtils';
import { writeLocalEgressHandoffAsync } from '../localEgress';
import {
  type GuardEvent,
  installLocalEgressGuardAsync,
  parseGuardLogLine,
  resolveEgressGuardCheckAsync,
  resolveEgressGuardLibraryAsync,
  stopLocalEgressGuardRelaysAsync,
  verifyLocalEgressGuardAsync,
} from '../localEgressGuard';

jest.unmock('fs');
jest.unmock('node:fs');
jest.unmock('fs/promises');
jest.unmock('node:fs/promises');
jest.setTimeout(15 * 60 * 1000);

const enabled = process.platform === 'darwin' && process.env.EAS_LOCAL_EGRESS_E2E === '1';
const describeE2E = enabled ? describe : describe.skip;

const GUARD_DIR = path.join(__dirname, '..', '..', '..', '..', 'resources', 'egress-guard');
const env = process.env;

function createLogger(): bunyan & { lines: string[] } {
  const lines: string[] = [];
  const record = (a: unknown, b?: unknown) => {
    lines.push(typeof a === 'string' ? a : String(b));
  };
  return { info: record, warn: record, debug: record, lines } as any;
}

async function readEventsAsync(logPath: string): Promise<GuardEvent[]> {
  let raw = '';
  try {
    raw = await fs.promises.readFile(logPath, 'utf8');
  } catch {
    return [];
  }
  return raw
    .split('\n')
    .map(parseGuardLogLine)
    .filter((e): e is GuardEvent => e !== null);
}

async function waitForAsync<T>(
  probe: () => Promise<T | undefined>,
  { timeoutMs, intervalMs = 1000 }: { timeoutMs: number; intervalMs?: number }
): Promise<T | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value !== undefined) {
      return value;
    }
    await sleep(intervalMs);
  }
  return undefined;
}

describeE2E('local egress guard in a booted simulator', () => {
  let workDir: string;
  let udid: IosSimulatorUuid;
  let bootedByTest = false;
  let libraryPath: string;
  let checkPath: string;
  let nettestPath: string;
  let handoffPath: string;
  let proxyServer: http.Server;
  let proxyPort: number;
  let udpServer: dgram.Socket;
  let udpPort: number;
  const logger = createLogger();

  async function installAsync(mode: 'block' | 'log', logPath: string): Promise<boolean> {
    const installed = await installLocalEgressGuardAsync({
      udid,
      env,
      logger,
      handoffPath,
      libraryPath,
      logPath,
      mode,
      tailIntervalMs: 100,
    });
    // The same self-check the worker runs once boot completes.
    await verifyLocalEgressGuardAsync({ udid, env, logger, mode, checkPath });
    return installed;
  }

  async function runNettestAsync(): Promise<Record<string, string>> {
    const result = await spawn(
      'xcrun',
      [
        'simctl',
        'spawn',
        udid,
        nettestPath,
        '--proxy-port',
        String(proxyPort),
        '--udp-port',
        String(udpPort),
      ],
      { env, stdio: 'pipe' }
    );
    const last = result.stdout.trim().split('\n').at(-1) ?? '{}';
    return JSON.parse(last);
  }

  beforeAll(async () => {
    workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'egress-guard-e2e-'));

    // The guard library, built on demand.
    let resolved = await resolveEgressGuardLibraryAsync();
    if (!resolved) {
      await spawn('bash', [path.join(GUARD_DIR, 'build.sh')], { env, stdio: 'pipe' });
      resolved = await resolveEgressGuardLibraryAsync();
    }
    if (!resolved) {
      throw new Error('egress-guard.dylib is not available and could not be built.');
    }
    libraryPath = resolved;
    const resolvedCheck = await resolveEgressGuardCheckAsync();
    if (!resolvedCheck) {
      throw new Error('egress-guard-check is not available and could not be built.');
    }
    checkPath = resolvedCheck;

    // The probe binary, compiled for the simulator running on this host.
    nettestPath = path.join(workDir, 'nettest');
    await spawn(
      'xcrun',
      [
        '-sdk',
        'iphonesimulator',
        'swiftc',
        '-target',
        `${process.arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-ios15.0-simulator`,
        path.join(GUARD_DIR, 'tests', 'nettest.swift'),
        '-o',
        nettestPath,
      ],
      { env, stdio: 'pipe' }
    );

    // A device. Reuse a booted iPhone when there is one; otherwise boot one and
    // shut it down afterwards. Never delete anything.
    const booted = await IosSimulatorUtils.getAvailableDevicesAsync({ env, filter: 'booted' });
    const bootedIphone = booted.find(d => /^iPhone/.test(d.name));
    if (bootedIphone) {
      udid = bootedIphone.udid;
    } else {
      const available = await IosSimulatorUtils.getAvailableDevicesAsync({
        env,
        filter: 'available',
      });
      const iphone =
        available.find(d => /^iPhone \d/.test(d.name)) ??
        available.find(d => /^iPhone/.test(d.name));
      if (!iphone) {
        throw new Error('No iPhone simulator is available.');
      }
      udid = iphone.udid;
      await spawn('xcrun', ['simctl', 'boot', udid], { env, stdio: 'pipe' });
      bootedByTest = true;
    }
    await IosSimulatorUtils.startAsync({ deviceIdentifier: udid, env });

    // Loopback stand-ins for the egress proxy and for a local UDP service.
    proxyServer = http.createServer((_req, res) => {
      res.writeHead(502);
      res.end();
    });
    proxyServer.on('connect', (req, socket, head) => {
      const [host, port] = String(req.url).split(':');
      const upstream = net.connect(Number(port) || 443, host, () => {
        socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length) {
          upstream.write(new Uint8Array(head));
        }
        upstream.pipe(socket);
        socket.pipe(upstream);
      });
      upstream.on('error', () => socket.destroy());
      socket.on('error', () => upstream.destroy());
    });
    await new Promise<void>(resolve => proxyServer.listen(0, '127.0.0.1', () => resolve()));
    proxyPort = (proxyServer.address() as net.AddressInfo).port;

    udpServer = dgram.createSocket('udp4');
    udpServer.on('message', (msg, rinfo) =>
      udpServer.send(new Uint8Array(msg), rinfo.port, rinfo.address)
    );
    await new Promise<void>(resolve => udpServer.bind(0, '127.0.0.1', () => resolve()));
    udpPort = udpServer.address().port;

    handoffPath = path.join(workDir, 'handoff.json');
    await writeLocalEgressHandoffAsync(
      { url: 'https://egress.example', token: 'pw', fingerprint: 'fp=', port: 8899 },
      handoffPath
    );
  });

  afterAll(async () => {
    await stopLocalEgressGuardRelaysAsync(logger);
    proxyServer?.close();
    udpServer?.close();
    if (bootedByTest && udid) {
      await spawn('xcrun', ['simctl', 'shutdown', udid], { env, stdio: 'pipe' }).catch(() => {});
    }
    if (workDir) {
      await fs.promises.rm(workDir, { recursive: true, force: true });
    }
  });

  it('refuses every direct path and leaves loopback and DNS alone', async () => {
    const logPath = path.join(workDir, 'block.log');
    expect(await installAsync('block', logPath)).toBe(true);

    const results = await runNettestAsync();

    expect(results).toMatchObject({
      urlsessionDirect: 'refused',
      urlsessionProxied: 'ok(200)',
      bsdConnectDirect: 'refused',
      dns: 'ok',
      udpDirect: 'refused',
      udpLoopback: 'ok',
      literalFirst: 'refused',
      literalSecond: 'refused',
    });
    expect(results.nwconnectionDirect).not.toMatch(/^ok|^timeout/);

    const events = (await readEventsAsync(logPath)).filter(e => e.process === 'nettest');
    expect(events.length).toBeGreaterThanOrEqual(4);
    expect(events.every(e => e.action === 'blocked')).toBe(true);
    // URLSession and Network.framework connects are caught inside Apple's frameworks.
    expect(
      events.some(e => e.function === 'connect' && e.callers.some(c => /CFNetwork/.test(c)))
    ).toBe(true);
    expect(
      events.some(
        e =>
          e.function === 'connect' && e.callers.some(c => /Network/.test(c) && !/CFNetwork/.test(c))
      )
    ).toBe(true);
    // UDP is covered.
    expect(events.some(e => e.function === 'sendto' && e.peer === '8.8.8.8:53')).toBe(true);
    // One line per destination per process, even when the process retries.
    expect(events.filter(e => e.function === 'connect' && e.peer === '1.1.1.1:443')).toHaveLength(
      1
    );
    // Nothing on loopback is ever reported.
    expect(events.some(e => /^127\./.test(e.peer))).toBe(false);
  });

  it('guards processes the simulator launches on its own', async () => {
    const logPath = path.join(workDir, 'daemons.log');
    expect(await installAsync('block', logPath)).toBe(true);

    await spawn('xcrun', ['simctl', 'openurl', udid, 'https://example.net/'], {
      env,
      stdio: 'pipe',
    });

    const daemonEvent = await waitForAsync(
      async () =>
        (await readEventsAsync(logPath)).find(
          e => e.process !== 'nettest' && e.action === 'blocked'
        ),
      { timeoutMs: 60_000 }
    );
    expect(daemonEvent).toBeDefined();
  });

  it('does not interfere with the simulator tooling the worker relies on', async () => {
    const screenshot = path.join(workDir, 'screenshot.png');
    for (const args of [
      ['simctl', 'spawn', udid, 'launchctl', 'list'],
      [
        'simctl',
        'spawn',
        udid,
        'defaults',
        'write',
        'dev.expo.egress-guard-test',
        'key',
        '-string',
        'value',
      ],
      ['simctl', 'spawn', udid, '/usr/bin/env'],
      ['simctl', 'launch', udid, 'com.apple.Preferences'],
      ['simctl', 'io', udid, 'screenshot', screenshot],
    ]) {
      await expect(spawn('xcrun', args, { env, stdio: 'pipe' })).resolves.toBeDefined();
    }
    expect(fs.existsSync(screenshot)).toBe(true);
  });

  it('observes without refusing in log mode', async () => {
    const logPath = path.join(workDir, 'log-mode.log');
    expect(await installAsync('log', logPath)).toBe(true);

    const results = await runNettestAsync();

    expect(results.urlsessionDirect).toBe('ok(200)');
    expect(results.bsdConnectDirect).toBe('ok');
    expect(results.udpDirect).toBe('sent');
    const events = (await readEventsAsync(logPath)).filter(e => e.process === 'nettest');
    expect(events.length).toBeGreaterThan(0);
    expect(events.every(e => e.action === 'logged')).toBe(true);
  });

  it('reports a missing guard through the self-check', async () => {
    // Point launchd at a library path that does not exist: dyld ignores it, so
    // a fresh process runs unguarded, which the check must catch.
    await IosSimulatorUtils.setLaunchdEnvironmentAsync({
      udid,
      env,
      variables: { DYLD_INSERT_LIBRARIES: path.join(workDir, 'missing.dylib') },
    });
    await expect(
      verifyLocalEgressGuardAsync({ udid, env, logger, mode: 'block', checkPath })
    ).rejects.toThrow(/not in effect/);
    await IosSimulatorUtils.setLaunchdEnvironmentAsync({
      udid,
      env,
      variables: { DYLD_INSERT_LIBRARIES: libraryPath },
    });
  });

  it('keeps refusing when the log file cannot be written', async () => {
    const logPath = path.join(workDir, 'no-such-dir', 'guard.log');
    expect(await installAsync('block', logPath)).toBe(true);

    const results = await runNettestAsync();

    expect(results.urlsessionDirect).toBe('refused');
    expect(results.bsdConnectDirect).toBe('refused');
    expect(results.urlsessionProxied).toBe('ok(200)');
  });
});
