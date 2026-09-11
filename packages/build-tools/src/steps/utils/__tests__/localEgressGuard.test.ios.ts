/**
 * End-to-end test of the local egress guard against a real iOS Simulator.
 * Needs Xcode with a simulator runtime, a shut-down iPhone simulator, and
 * network access. Opt in with EAS_LOCAL_EGRESS_E2E=1; the test-egress-guard
 * EAS workflow runs it on macOS.
 *
 * Variables handed to launchd at boot cannot be changed afterwards with
 * `launchctl setenv`, so each configuration gets its own boot.
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
  reportLocalEgressGuardCoverageAsync,
  resolveEgressGuardCheckAsync,
  resolveEgressGuardLibraryAsync,
  resolveLocalEgressBootEnvironmentAsync,
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

describeE2E('local egress guard in a simulator', () => {
  let workDir: string;
  let udid: IosSimulatorUuid;
  let libraryPath: string;
  let checkPath: string;
  let nettestPath: string;
  let handoffPath: string;
  let proxyServer: http.Server;
  let proxyPort: number;
  let udpServer: dgram.Socket;
  let udpPort: number;
  const logger = createLogger();

  /** Shut the device down and boot it again with the given launchd environment. */
  async function rebootAsync(launchdEnvironment: Record<string, string>): Promise<void> {
    await spawn('xcrun', ['simctl', 'shutdown', udid], { env, stdio: 'pipe' }).catch(() => {});
    await IosSimulatorUtils.bootAsync({ deviceIdentifier: udid, env, launchdEnvironment });
    await IosSimulatorUtils.startAsync({ deviceIdentifier: udid, env });
  }

  async function bootEnvironmentAsync(
    mode: 'block' | 'log',
    logPath: string
  ): Promise<Record<string, string>> {
    const variables = await resolveLocalEgressBootEnvironmentAsync({
      handoffPath,
      libraryPath,
      logPath,
      mode,
    });
    if (!variables) {
      throw new Error('The handoff was not written.');
    }
    return variables;
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

    // The guard library and self-check, built on demand.
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

    handoffPath = path.join(workDir, 'handoff.json');
    await writeLocalEgressHandoffAsync(
      { url: 'https://egress.example', token: 'pw', fingerprint: 'fp=', port: 8899 },
      handoffPath
    );

    // A shut-down iPhone the test can boot as many times as it needs. A device
    // someone else booted is left alone. Nothing is ever deleted.
    const booted = new Set(
      (await IosSimulatorUtils.getAvailableDevicesAsync({ env, filter: 'booted' })).map(d => d.udid)
    );
    const available = await IosSimulatorUtils.getAvailableDevicesAsync({
      env,
      filter: 'available',
    });
    const iphone =
      available.find(d => /^iPhone \d/.test(d.name) && !booted.has(d.udid)) ??
      available.find(d => /^iPhone/.test(d.name) && !booted.has(d.udid));
    if (!iphone) {
      throw new Error('No shut-down iPhone simulator is available for the test to boot.');
    }
    udid = iphone.udid;

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
  });

  afterAll(async () => {
    await stopLocalEgressGuardRelaysAsync(logger);
    proxyServer?.close();
    udpServer?.close();
    if (udid) {
      await spawn('xcrun', ['simctl', 'shutdown', udid], { env, stdio: 'pipe' }).catch(() => {});
    }
    if (workDir) {
      await fs.promises.rm(workDir, { recursive: true, force: true });
    }
  });

  describe('booted with the guard in launchd, as the worker boots', () => {
    let logPath: string;

    beforeAll(async () => {
      logPath = path.join(workDir, 'boot.log');
      await rebootAsync(await bootEnvironmentAsync('block', logPath));
      await verifyLocalEgressGuardAsync({ udid, env, logger, mode: 'block', checkPath });
    });

    it('covers every process of the boot', async () => {
      const coverage = await reportLocalEgressGuardCoverageAsync({ env, logger });
      expect(coverage).not.toBeNull();
      expect(coverage!.covered.length).toBeGreaterThan(50);
      expect(coverage!.uncovered).toEqual([]);
      // Refusals were recorded by processes that started during the boot, before
      // any launchctl call could have reached them.
      expect((await readEventsAsync(logPath)).length).toBeGreaterThan(0);
    });

    it('refuses every direct path and leaves loopback and DNS alone', async () => {
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
            e.function === 'connect' &&
            e.callers.some(c => /Network/.test(c) && !/CFNetwork/.test(c))
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
  });

  describe('booted in log mode', () => {
    let logPath: string;

    beforeAll(async () => {
      logPath = path.join(workDir, 'log-mode.log');
      await rebootAsync(await bootEnvironmentAsync('log', logPath));
      await verifyLocalEgressGuardAsync({ udid, env, logger, mode: 'log', checkPath });
    });

    it('observes without refusing', async () => {
      const results = await runNettestAsync();

      expect(results.urlsessionDirect).toBe('ok(200)');
      expect(results.bsdConnectDirect).toBe('ok');
      expect(results.udpDirect).toBe('sent');
      const events = (await readEventsAsync(logPath)).filter(e => e.process === 'nettest');
      expect(events.length).toBeGreaterThan(0);
      expect(events.every(e => e.action === 'logged')).toBe(true);
    });
  });

  describe('booted without the guard, as a device that was already running', () => {
    beforeAll(async () => {
      await rebootAsync({});
    });

    it('is reported as not in effect by the self-check', async () => {
      await expect(
        verifyLocalEgressGuardAsync({ udid, env, logger, mode: 'block', checkPath })
      ).rejects.toThrow(/not in effect/);
    });

    it('can be installed after boot through launchctl for processes started from then on', async () => {
      const logPath = path.join(workDir, 'install.log');
      expect(
        await installLocalEgressGuardAsync({
          udid,
          env,
          logger,
          handoffPath,
          libraryPath,
          logPath,
          mode: 'block',
          tailIntervalMs: 100,
        })
      ).toBe(true);
      await verifyLocalEgressGuardAsync({ udid, env, logger, mode: 'block', checkPath });

      const results = await runNettestAsync();
      expect(results.urlsessionDirect).toBe('refused');
      expect(results.bsdConnectDirect).toBe('refused');

      // The relay turns the guard's events into session log lines.
      const relayed = await waitForAsync(
        async () =>
          logger.lines.find(l =>
            /refused connect from nettest \(pid \d+\) to 1\.1\.1\.1:443/.test(l)
          ),
        { timeoutMs: 5_000, intervalMs: 200 }
      );
      expect(relayed).toBeDefined();

      // Processes from before the install are the uncovered set the coverage
      // report names; nettest itself was covered.
      const coverage = await reportLocalEgressGuardCoverageAsync({ env, logger });
      expect(coverage!.uncovered.length).toBeGreaterThan(0);
    });
  });

  describe('booted with an unwritable event log', () => {
    beforeAll(async () => {
      await rebootAsync(
        await bootEnvironmentAsync('block', path.join(workDir, 'no-such-dir', 'guard.log'))
      );
    });

    it('still refuses', async () => {
      await verifyLocalEgressGuardAsync({ udid, env, logger, mode: 'block', checkPath });
      const results = await runNettestAsync();
      expect(results.urlsessionDirect).toBe('refused');
      expect(results.bsdConnectDirect).toBe('refused');
      expect(results.urlsessionProxied).toBe('ok(200)');
    });
  });
});
