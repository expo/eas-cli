import { SystemError } from '@expo/eas-build-job';
import { type bunyan } from '@expo/logger';
import { asyncResult } from '@expo/results';
import { type BuildStepEnv } from '@expo/steps';
import spawn from '@expo/turtle-spawn';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import readline from 'node:readline';

import {
  type AndroidDeviceSerialId,
  type AndroidEmulatorLaunchGate,
} from '../../utils/AndroidEmulatorUtils';
import { sleepAsync } from '../../utils/retry';

import {
  LOCAL_EGRESS_HANDOFF_PATH,
  LOCAL_EGRESS_PROXY_HOST,
  readLocalEgressHandoffAsync,
} from './localEgress';
import {
  type GuardEvent,
  GuardEventRelay,
  registerLocalEgressGuardRelay,
} from './localEgressGuard';

/**
 * Android emulator side of local egress, on Linux device hosts.
 *
 * - The emulator's `-http-proxy` points at a relay on LOCAL_EGRESS_RELAY_PORT.
 *   The relay always listens, because qemu tests the proxy once at startup and
 *   ignores it for the emulator's whole life if that test fails. It forwards
 *   each connection to the chisel listener, which exists only while the EAS
 *   CLI egress client is connected, and refuses the request otherwise.
 * - The guest's system proxy is the relay as well (10.0.2.2 is host loopback),
 *   so proxy-aware clients send hostnames instead of IP addresses.
 * - Every emulator process runs in one systemd scope. An nftables table refuses
 *   traffic from that scope that is not loopback TCP or DNS to
 *   systemd-resolved: UDP, QUIC, ICMP and the emulator's
 *   own direct connections. Kernel log lines from the fence become session log
 *   lines through the guard relay.
 *
 * This keeps routing faithful; it is not a security boundary.
 */

export const LOCAL_EGRESS_RELAY_PORT = 8898;
export const ANDROID_EMULATOR_HOST_LOOPBACK_ALIAS = '10.0.2.2';
/** TEST-NET-1; the relay answers CONNECTs to it itself, so it proves the proxy path is up. */
export const LOCAL_EGRESS_READINESS_TARGET = { host: '192.0.2.1', port: 443 } as const;
export const LOCAL_EGRESS_SESSION_UNIT = 'eas-egress-session';
export const EGRESS_FENCE_TABLE = 'eas_fence';
const FENCE_LOG_PREFIX = 'eas-egress';
const FENCE_RELAY_KEY = 'android-emulator-fence';
const FENCED_PROCESS_LABEL = 'Android emulator';
const FENCED_PROCESS_PATTERN = /^(qemu-system|netsimd|crashpad_handle)/;
const RELAY_MAX_HEAD_BYTES = 16 * 1024;
const SCOPE_STARTUP_TIMEOUT_MS = 10_000;
const ADB_REVERSE_INTERVAL_MS = 3_000;
const GATE_SCRIPT = 'read -r _ || exit 1; exec "$@" < /dev/null';

const CONNECTION_ESTABLISHED = 'HTTP/1.1 200 Connection Established\r\n\r\n';
const CLIENT_NOT_CONNECTED_BODY = 'The EAS CLI local egress client is not connected.\r\n';
const CLIENT_NOT_CONNECTED =
  'HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Type: text/plain\r\n' +
  `Content-Length: ${Buffer.byteLength(CLIENT_NOT_CONNECTED_BODY)}\r\n\r\n${CLIENT_NOT_CONNECTED_BODY}`;

// ---------------------------------------------------------------------------
// Relay
// ---------------------------------------------------------------------------

export function parseConnectAuthority(head: string): { host: string; port: number } | null {
  const match = /^CONNECT\s+(\[[^\]]+\]|[^\s:]+):(\d{1,5})\s+HTTP\/1\.[01]\r?\n/i.exec(head);
  if (!match) {
    return null;
  }
  return { host: match[1].replace(/^\[|\]$/g, '').toLowerCase(), port: Number(match[2]) };
}

function isReadinessTarget({ host, port }: { host: string; port: number }): boolean {
  return host === LOCAL_EGRESS_READINESS_TARGET.host && port === LOCAL_EGRESS_READINESS_TARGET.port;
}

/**
 * On the emulator's Wi-Fi path, a guest connection to the guest proxy
 * (10.0.2.2:<relay port>) is itself wrapped in `-http-proxy`'s CONNECT.
 */
function isRelayTarget({ host, port }: { host: string; port: number }, relayPort: number): boolean {
  return (
    port === relayPort &&
    (host === LOCAL_EGRESS_PROXY_HOST ||
      host === ANDROID_EMULATOR_HOST_LOOPBACK_ALIAS ||
      host === 'localhost')
  );
}

export type LocalEgressRelay = {
  port: number;
  setLogger: (logger: bunyan) => void;
  stopAsync: () => Promise<void>;
};

export async function startLocalEgressRelayAsync({
  port = LOCAL_EGRESS_RELAY_PORT,
  upstreamPort,
  logger,
}: {
  port?: number;
  upstreamPort: number;
  logger: bunyan;
}): Promise<LocalEgressRelay> {
  let currentLogger = logger;
  let refusedWhileDetached = 0;
  const sockets = new Set<net.Socket>();
  const track = (socket: net.Socket): void => {
    sockets.add(socket);
    socket.on('error', () => socket.destroy());
    socket.once('close', () => sockets.delete(socket));
  };
  const endWith = (client: net.Socket, response: string): void => {
    client.end(response, () => client.destroy());
  };

  const refuse = (client: net.Socket): void => {
    if (refusedWhileDetached === 0) {
      currentLogger.warn(
        'Local egress: the Android emulator made a request while the EAS CLI egress client is not ' +
          'connected, so it was refused. Requests from the emulator fail until the client connects.'
      );
    }
    refusedWhileDetached++;
    endWith(client, CLIENT_NOT_CONNECTED);
  };

  const attached = (): void => {
    if (refusedWhileDetached > 0) {
      currentLogger.info(
        `Local egress: the EAS CLI egress client is connected. ${refusedWhileDetached} request(s) ` +
          'from the Android emulator were refused while it was not.'
      );
      refusedWhileDetached = 0;
    }
  };

  const forward = (client: net.Socket, buffered: Buffer): void => {
    const upstream = net.connect({ host: LOCAL_EGRESS_PROXY_HOST, port: upstreamPort });
    track(upstream);
    let connected = false;
    upstream.once('connect', () => {
      connected = true;
      attached();
      if (buffered.length > 0) {
        upstream.write(buffered);
      }
      client.pipe(upstream);
      upstream.pipe(client);
      client.resume();
    });
    upstream.once('error', () => {
      if (!connected && !client.destroyed) {
        refuse(client);
      }
    });
    upstream.once('close', () => {
      if (connected) {
        client.destroy();
      }
    });
    client.once('close', () => upstream.destroy());
  };

  const route = (client: net.Socket, initial: Buffer): void => {
    let buffered = initial;
    const decide = (): void => {
      const headEnd = buffered.indexOf('\r\n\r\n');
      if (headEnd === -1 && buffered.length < RELAY_MAX_HEAD_BYTES) {
        return;
      }
      client.off('data', onData);
      client.pause();
      const target =
        headEnd === -1
          ? null
          : parseConnectAuthority(buffered.subarray(0, headEnd + 2).toString('latin1'));
      if (target && isReadinessTarget(target)) {
        endWith(client, CONNECTION_ESTABLISHED);
      } else if (target && isRelayTarget(target, port)) {
        client.write(CONNECTION_ESTABLISHED);
        route(client, buffered.subarray(headEnd + 4));
      } else {
        forward(client, buffered);
      }
    };
    const onData = (chunk: Buffer): void => {
      buffered = Buffer.concat([buffered, chunk]);
      decide();
    };
    client.on('data', onData);
    client.resume();
    if (buffered.length > 0) {
      decide();
    }
  };

  const server = net.createServer(client => {
    track(client);
    route(client, Buffer.alloc(0));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, LOCAL_EGRESS_PROXY_HOST, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  server.unref();

  return {
    port,
    setLogger: nextLogger => {
      currentLogger = nextLogger;
    },
    stopAsync: async () => {
      await new Promise<void>(resolve => {
        server.close(() => resolve());
        for (const socket of sockets) {
          socket.destroy();
        }
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Fence
// ---------------------------------------------------------------------------

export function buildEgressFenceRuleset({ cgroupLevel }: { cgroupLevel: number }): string {
  return [
    `table inet ${EGRESS_FENCE_TABLE} {`,
    '  set fenced { type cgroupsv2; }',
    '  counter fence_tcp {}',
    '  counter fence_udp {}',
    '  counter fence_other {}',
    '  chain out {',
    '    type filter hook output priority filter; policy accept;',
    '    ct state established,related accept',
    `    socket cgroupv2 level ${cgroupLevel} @fenced jump fence`,
    '  }',
    '  chain fence {',
    // The emulator and netsimd talk to each other and to adb over loopback TCP;
    // guest TCP reaches loopback only through the proxy.
    '    oif "lo" meta l4proto tcp accept',
    '    oif "lo" ip daddr 127.0.0.53 udp dport 53 accept',
    `    limit rate 50/second burst 200 packets log prefix "${FENCE_LOG_PREFIX} " level info`,
    '    meta l4proto tcp counter name fence_tcp reject with tcp reset',
    '    meta l4proto udp counter name fence_udp reject with icmpx admin-prohibited',
    '    counter name fence_other reject with icmpx admin-prohibited',
    '  }',
    '}',
    '',
  ].join('\n');
}

function compressIpv6(address: string): string {
  try {
    return new URL(`http://[${address}]`).hostname.slice(1, -1);
  } catch {
    return address;
  }
}

/**
 * One kernel log line from the fence's `log` rule, for example
 * `eas-egress IN= OUT=ens3 SRC=10.0.0.2 DST=142.250.1.1 LEN=60 ... PROTO=TCP SPT=40000 DPT=443 ...`.
 * nft sees the emulator's sockets, not the guest app behind them, so events
 * carry no pid or callers.
 */
export function parseFenceLogLine(line: string): GuardEvent | null {
  const match = new RegExp(`${FENCE_LOG_PREFIX} (IN=.*)$`).exec(line);
  if (!match) {
    return null;
  }
  const fields = new Map<string, string>();
  for (const token of match[1].split(/\s+/)) {
    const separator = token.indexOf('=');
    if (separator > 0) {
      fields.set(token.slice(0, separator), token.slice(separator + 1));
    }
  }
  const protocol = fields.get('PROTO')?.toLowerCase();
  const destination = fields.get('DST');
  if (!protocol || !destination) {
    return null;
  }
  const fn = protocol === 'icmpv6' ? 'icmp' : protocol;
  const host = net.isIPv6(destination) ? compressIpv6(destination) : destination;
  const destinationPort = fields.get('DPT');
  const peer = destinationPort
    ? `${net.isIPv6(host) ? `[${host}]` : host}:${destinationPort}`
    : host;
  return {
    process: FENCED_PROCESS_LABEL,
    pid: null,
    function: fn,
    action: 'blocked',
    peer,
    callers: [],
    note: describeFenceEvent(fn, destinationPort),
  };
}

function describeFenceEvent(fn: string, destinationPort: string | undefined): string | undefined {
  if (fn === 'tcp') {
    return 'a connection the emulator itself opened, such as its update check; app TCP goes through the proxy';
  }
  if (fn === 'udp' && destinationPort === '443') {
    return 'QUIC; clients usually retry over TCP through the proxy';
  }
  return undefined;
}

export type FenceCounters = { tcp: number; udp: number; other: number };

/** `nft -j list counters table inet eas_fence` output. */
export function parseFenceCounters(json: string): FenceCounters {
  const counters: FenceCounters = { tcp: 0, udp: 0, other: 0 };
  const parsed = JSON.parse(json) as {
    nftables?: { counter?: { name?: string; packets?: number } }[];
  };
  for (const entry of parsed.nftables ?? []) {
    const name = entry.counter?.name;
    const packets = entry.counter?.packets ?? 0;
    if (name === 'fence_tcp') {
      counters.tcp = packets;
    } else if (name === 'fence_udp') {
      counters.udp = packets;
    } else if (name === 'fence_other') {
      counters.other = packets;
    }
  }
  return counters;
}

export function getCgroupLevel(cgroupPath: string): number {
  return cgroupPath.split('/').filter(Boolean).length;
}

async function startSessionScopeAsync({ env }: { env: BuildStepEnv }): Promise<string> {
  const scope = spawn(
    'sudo',
    [
      'systemd-run',
      '--scope',
      '--quiet',
      `--unit=${LOCAL_EGRESS_SESSION_UNIT}`,
      '--',
      'sleep',
      'infinity',
    ],
    { env, detached: true, stdio: 'ignore' }
  );
  scope.child.unref();
  let exited = false;
  void asyncResult(scope).then(() => {
    exited = true;
  });

  const deadline = Date.now() + SCOPE_STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const result = await asyncResult(
      spawn(
        'systemctl',
        ['show', '-p', 'ControlGroup', '--value', `${LOCAL_EGRESS_SESSION_UNIT}.scope`],
        { env, stdio: 'pipe' }
      )
    );
    const cgroupPath = result.ok ? result.value.stdout.trim().replace(/^\//, '') : '';
    if (cgroupPath) {
      return cgroupPath;
    }
    if (exited) {
      break;
    }
    await sleepAsync(200);
  }
  throw new SystemError(
    `Could not start the ${LOCAL_EGRESS_SESSION_UNIT} systemd scope for the Android emulator, so ` +
      'local egress cannot keep its traffic on the tunnel. Retry the session; if it keeps failing, ' +
      'please contact support.'
  );
}

async function loadFenceAsync({
  cgroupPath,
  workDir,
  env,
}: {
  cgroupPath: string;
  workDir: string;
  env: BuildStepEnv;
}): Promise<void> {
  const rulesetPath = path.join(workDir, 'fence.nft');
  await fs.promises.writeFile(
    rulesetPath,
    buildEgressFenceRuleset({ cgroupLevel: getCgroupLevel(cgroupPath) })
  );
  await asyncResult(
    spawn('sudo', ['nft', 'delete', 'table', 'inet', EGRESS_FENCE_TABLE], { env, stdio: 'pipe' })
  );
  try {
    await spawn('sudo', ['nft', '-f', rulesetPath], { env, stdio: 'pipe' });
    await spawn(
      'sudo',
      ['nft', 'add', 'element', 'inet', EGRESS_FENCE_TABLE, 'fenced', `{ "${cgroupPath}" }`],
      { env, stdio: 'pipe' }
    );
  } catch (err) {
    const failed = err as { stderr?: string };
    throw new SystemError(
      'Could not install the network fence for the Android emulator, so local egress cannot keep its ' +
        'traffic on the tunnel. Retry the session; if it keeps failing, please contact support.' +
        (failed.stderr ? ` nft output: ${failed.stderr.trim()}` : ''),
      { cause: err }
    );
  }
}

async function readFenceCountersAsync({ env }: { env: BuildStepEnv }): Promise<FenceCounters> {
  const result = await spawn(
    'sudo',
    ['nft', '-j', 'list', 'counters', 'table', 'inet', EGRESS_FENCE_TABLE],
    { env, stdio: 'pipe' }
  );
  return parseFenceCounters(result.stdout);
}

function startFenceLogReader({
  env,
  sinceEpochSeconds,
  relay,
  getLogger,
}: {
  env: BuildStepEnv;
  sinceEpochSeconds: number;
  relay: GuardEventRelay;
  getLogger: () => bunyan;
}): { stopAsync: () => Promise<void> } {
  const reader = spawn(
    'sudo',
    ['journalctl', '-k', '-f', '-o', 'cat', '--since', `@${sinceEpochSeconds}`],
    { env, stdio: ['ignore', 'pipe', 'pipe'], ignoreStdio: true }
  );
  let stopping = false;
  const lines = reader.child.stdout
    ? readline.createInterface({ input: reader.child.stdout }).on('line', line => {
        const event = parseFenceLogLine(line);
        if (event) {
          relay.handle(event);
        }
      })
    : undefined;
  const finished = asyncResult(reader).then(() => {
    if (!stopping) {
      getLogger().warn(
        'Local egress: stopped reading the kernel log, so further connections the Android emulator ' +
          'fence refuses are not listed here. They are still refused.'
      );
    }
  });
  reader.child.unref();
  for (const stream of [reader.child.stdout, reader.child.stderr]) {
    if (stream instanceof net.Socket) {
      stream.unref();
    }
  }
  return {
    stopAsync: async () => {
      stopping = true;
      // Kernel log lines arrive slightly after the packet; give the last ones a moment.
      await sleepAsync(500);
      reader.child.kill('SIGTERM');
      await finished;
      lines?.close();
    },
  };
}

// ---------------------------------------------------------------------------
// Process coverage
// ---------------------------------------------------------------------------

export type EmulatorProcess = { pid: number; comm: string; cgroup: string };

export async function listEmulatorProcessesAsync(procRoot = '/proc'): Promise<EmulatorProcess[]> {
  const entries = await fs.promises.readdir(procRoot);
  const processes: EmulatorProcess[] = [];
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) {
      continue;
    }
    try {
      const comm = (await fs.promises.readFile(path.join(procRoot, entry, 'comm'), 'utf8')).trim();
      if (!FENCED_PROCESS_PATTERN.test(comm)) {
        continue;
      }
      const cgroupFile = await fs.promises.readFile(path.join(procRoot, entry, 'cgroup'), 'utf8');
      const cgroup = /^0::(\S*)$/m.exec(cgroupFile)?.[1] ?? '';
      processes.push({ pid: Number(entry), comm, cgroup });
    } catch {
      // The process exited while it was being read.
    }
  }
  return processes;
}

export function findProcessesOutsideScope(
  processes: readonly EmulatorProcess[],
  cgroupPath: string
): EmulatorProcess[] {
  const scope = `/${cgroupPath}`;
  return processes.filter(({ cgroup }) => cgroup !== scope && !cgroup.startsWith(`${scope}/`));
}

async function assertEmulatorProcessesFencedAsync({
  cgroupPath,
  when,
}: {
  cgroupPath: string;
  when: string;
}): Promise<void> {
  const outside = findProcessesOutsideScope(await listEmulatorProcessesAsync(), cgroupPath);
  if (outside.length === 0) {
    return;
  }
  throw new SystemError(
    `Android emulator processes are running outside the local egress fence ${when}: ${outside
      .map(({ comm, pid, cgroup }) => `${comm} (pid ${pid}, ${cgroup || 'unknown cgroup'})`)
      .join(
        ', '
      )}. Their traffic would not use the tunnel, so the session was stopped. Retry the ` +
      'session; if it keeps failing, please contact support.'
  );
}

// ---------------------------------------------------------------------------
// adb reverse for --egress-allow localhost:<port>
// ---------------------------------------------------------------------------

/** Loopback ports `pid` listens on, from `ss -Hltnp`. */
export function parseLoopbackListenerPorts(ssOutput: string, pid: number): number[] {
  const ports = new Set<number>();
  for (const line of ssOutput.split('\n')) {
    if (!line.includes(`pid=${pid},`)) {
      continue;
    }
    const match = /\s127\.0\.0\.1:(\d+)\s/.exec(line);
    if (match) {
      ports.add(Number(match[1]));
    }
  }
  return [...ports].sort((a, b) => a - b);
}

export function parseAdbReversePorts(output: string): Set<number> {
  const ports = new Set<number>();
  for (const match of output.matchAll(/tcp:(\d+)\s+tcp:\d+/g)) {
    ports.add(Number(match[1]));
  }
  return ports;
}

/**
 * The EAS CLI forwards each `--egress-allow localhost:<port>` to the same
 * port on this host's loopback, where the guest cannot see it. `adb reverse`
 * makes guest `localhost:<port>` reach it. Reverse mappings are lost when an
 * emulator or the adb server restarts, so this runs on a timer.
 */
async function reconcileAdbReverseAsync({
  env,
  logger,
  chiselPid,
  tunnelPorts,
  reported,
  serialIds,
}: {
  env: BuildStepEnv;
  logger: bunyan;
  chiselPid: number;
  /** chisel's own listeners: the proxy port and the control port ngrok forwards to. */
  tunnelPorts: readonly number[];
  reported: Set<string>;
  serialIds?: AndroidDeviceSerialId[];
}): Promise<void> {
  const listeners = await spawn('ss', ['-Hltnp'], { env, stdio: 'pipe' });
  const ports = parseLoopbackListenerPorts(listeners.stdout, chiselPid).filter(
    port => !tunnelPorts.includes(port)
  );
  if (ports.length === 0) {
    return;
  }
  const serials =
    serialIds ??
    (await spawn('adb', ['devices'], { env, stdio: 'pipe' })).stdout
      .split('\n')
      .map(line => /^(emulator-\d+)\s+device\b/.exec(line)?.[1])
      .filter((serial): serial is AndroidDeviceSerialId => !!serial);
  for (const serial of serials) {
    const list = await asyncResult(
      spawn('adb', ['-s', serial, 'reverse', '--list'], { env, stdio: 'pipe' })
    );
    const existing = list.ok ? parseAdbReversePorts(list.value.stdout) : new Set<number>();
    for (const port of ports) {
      if (existing.has(port)) {
        continue;
      }
      const result = await asyncResult(
        spawn('adb', ['-s', serial, 'reverse', `tcp:${port}`, `tcp:${port}`], {
          env,
          stdio: 'pipe',
        })
      );
      const key = `${serial}:${port}`;
      if (result.ok && !reported.has(key)) {
        reported.add(key);
        logger.info(
          `Local egress: localhost:${port} in ${serial} now reaches port ${port} on the EAS CLI machine.`
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

type AndroidLocalEgressSession = {
  cgroupPath: string;
  env: BuildStepEnv;
  chiselPid: number;
  tunnelPorts: number[];
  relay: LocalEgressRelay;
  reportedReverse: Set<string>;
  reverseTimer?: NodeJS.Timeout;
  logger: bunyan;
};

let activeSession: AndroidLocalEgressSession | undefined;

/**
 * Start the relay, the session scope and the fence, and begin reporting fence
 * events. Runs in `eas/start_local_egress`, before any emulator starts. The
 * fence and scope stay in place until the job ends: removing them while an
 * emulator still runs would let its traffic leave from this host.
 */
export async function startAndroidLocalEgressAsync({
  env,
  logger,
  workDir,
  chiselPid,
  proxyPort,
  controlPort,
}: {
  env: BuildStepEnv;
  logger: bunyan;
  workDir: string;
  chiselPid: number;
  proxyPort: number;
  controlPort: number;
}): Promise<{ stopAsync: () => Promise<void> }> {
  if (activeSession) {
    throw new SystemError('Android local egress is already started for this job.');
  }
  const relay = await startLocalEgressRelayAsync({ upstreamPort: proxyPort, logger });
  try {
    const cgroupPath = await startSessionScopeAsync({ env });
    const sinceEpochSeconds = Math.floor(Date.now() / 1000) - 1;
    await loadFenceAsync({ cgroupPath, workDir, env });

    const guardRelay = new GuardEventRelay(logger);
    let guardLogger = logger;
    const reader = startFenceLogReader({
      env,
      sinceEpochSeconds,
      relay: guardRelay,
      getLogger: () => guardLogger,
    });
    registerLocalEgressGuardRelay(FENCE_RELAY_KEY, {
      source: reader,
      relay: guardRelay,
      onRebind: nextLogger => {
        guardLogger = nextLogger;
        relay.setLogger(nextLogger);
      },
      afterSummaryAsync: async () => {
        const { tcp, udp, other } = await readFenceCountersAsync({ env });
        guardLogger.info(
          `Local egress fence: refused ${tcp} TCP, ${udp} UDP and ${other} other packet(s) from the ` +
            'Android emulator in total, including retries and any not listed above.'
        );
      },
    });

    const session: AndroidLocalEgressSession = {
      cgroupPath,
      env,
      chiselPid,
      tunnelPorts: [proxyPort, controlPort],
      relay,
      reportedReverse: new Set(),
      logger,
    };
    session.reverseTimer = setInterval(() => {
      void reconcileAdbReverseAsync({
        env,
        logger: guardLogger,
        chiselPid,
        tunnelPorts: session.tunnelPorts,
        reported: session.reportedReverse,
      }).catch(() => {});
    }, ADB_REVERSE_INTERVAL_MS);
    session.reverseTimer.unref();
    activeSession = session;
    logger.info(
      `Local egress: Android emulator processes run in ${cgroupPath}, and the network fence ` +
        'refuses traffic that cannot use the tunnel and reports it here.'
    );
  } catch (err) {
    await relay.stopAsync();
    throw err;
  }

  return {
    stopAsync: async () => {
      const session = activeSession;
      activeSession = undefined;
      if (session?.reverseTimer) {
        clearInterval(session.reverseTimer);
      }
      await relay.stopAsync();
    },
  };
}

export type AndroidEmulatorLocalEgress = {
  launchGate: AndroidEmulatorLaunchGate;
  networkReadyTarget: { host: string; port: number };
  configureBootedEmulatorAsync: (args: {
    serialId: AndroidDeviceSerialId;
    logger: bunyan;
  }) => Promise<void>;
};

/**
 * What `eas/start_android_emulator` changes for a local egress session, or
 * null for every other session, which then starts the emulator exactly as
 * before.
 */
export async function resolveAndroidEmulatorLocalEgressAsync({
  handoffPath = LOCAL_EGRESS_HANDOFF_PATH,
}: { handoffPath?: string } = {}): Promise<AndroidEmulatorLocalEgress | null> {
  const handoff = await readLocalEgressHandoffAsync(handoffPath);
  if (!handoff) {
    return null;
  }
  const session = activeSession;
  if (handoff.platform !== 'android' || !session) {
    throw new SystemError(
      'This session uses local egress, but the Android emulator fence was not started, so the ' +
        "emulator's traffic would not use the tunnel. Please contact support."
    );
  }
  const relayAddress = `${LOCAL_EGRESS_PROXY_HOST}:${session.relay.port}`;
  return {
    launchGate: {
      emulatorArgs: ['-http-proxy', relayAddress, '-no-metrics'],
      wrapperCommand: 'bash',
      wrapperArgs: ['-c', GATE_SCRIPT, 'eas-egress-gate'],
      admitAsync: async pid => {
        await assertEmulatorProcessesFencedAsync({
          cgroupPath: session.cgroupPath,
          when: 'before the emulator started',
        });
        await admitToScopeAsync({ pid, cgroupPath: session.cgroupPath, env: session.env });
      },
    },
    networkReadyTarget: LOCAL_EGRESS_READINESS_TARGET,
    configureBootedEmulatorAsync: async ({ serialId, logger }) => {
      await assertEmulatorProcessesFencedAsync({
        cgroupPath: session.cgroupPath,
        when: 'after boot',
      });
      const guestProxy = `${ANDROID_EMULATOR_HOST_LOOPBACK_ALIAS}:${session.relay.port}`;
      const proxyResult = await asyncResult(
        spawn(
          'adb',
          ['-s', serialId, 'shell', 'settings', 'put', 'global', 'http_proxy', guestProxy],
          {
            env: session.env,
            stdio: 'pipe',
          }
        )
      );
      if (proxyResult.ok) {
        logger.info(
          `Local egress: the system proxy in ${serialId} is ${guestProxy}, so apps that honor it ` +
            "resolve hostnames on the EAS CLI machine. Other TCP still exits from that machine through the emulator's proxy."
        );
      } else {
        logger.warn(
          { err: proxyResult.reason },
          `Local egress: could not set the system proxy in ${serialId}. Traffic still exits from the ` +
            "EAS CLI machine through the emulator's proxy, but hostnames resolve on this worker."
        );
      }
      await reconcileAdbReverseAsync({
        env: session.env,
        logger,
        chiselPid: session.chiselPid,
        tunnelPorts: session.tunnelPorts,
        reported: session.reportedReverse,
        serialIds: [serialId],
      }).catch(err =>
        logger.warn(
          { err },
          `Local egress: could not forward allowed localhost ports to ${serialId}.`
        )
      );
    },
  };
}

async function admitToScopeAsync({
  pid,
  cgroupPath,
  env,
}: {
  pid: number;
  cgroupPath: string;
  env: BuildStepEnv;
}): Promise<void> {
  const procsPath = `/sys/fs/cgroup/${cgroupPath}/cgroup.procs`;
  try {
    await spawn('sudo', ['sh', '-c', 'echo "$1" > "$2"', 'sh', String(pid), procsPath], {
      env,
      stdio: 'pipe',
    });
    const cgroupFile = await fs.promises.readFile(`/proc/${pid}/cgroup`, 'utf8');
    if (!cgroupFile.includes(`0::/${cgroupPath}\n`)) {
      throw new Error(`/proc/${pid}/cgroup is ${cgroupFile.trim()}`);
    }
  } catch (err) {
    throw new SystemError(
      'Could not move the Android emulator into the local egress fence, so its traffic would not use ' +
        'the tunnel. Retry the session; if it keeps failing, please contact support.',
      { cause: err }
    );
  }
}
