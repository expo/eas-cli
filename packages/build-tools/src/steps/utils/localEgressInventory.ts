import { type bunyan } from '@expo/logger';
import { BuildStepEnv } from '@expo/steps';
import spawn from '@expo/turtle-spawn';
import dns from 'node:dns/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

/**
 * Local egress inventory: a log-only pf anchor plus a sampler of the worker's
 * own connections, so the hosts the device host must keep reaching can be
 * measured before any traffic is blocked.
 *
 * Simulator processes and the worker share a uid, so pf alone cannot tell them
 * apart. The anchor logs every TCP and UDP flow the uid opens to a non-loopback
 * peer, and the sampler lists the peers the worker process tree holds, which is
 * the attribution pf cannot give. A logged flow whose peer the worker tree also
 * holds is the worker's own; anything else came from the simulator and would
 * fail once a block rule exists.
 *
 * Nothing here blocks. The anchor lives under `com.apple/`, the only wildcard
 * the stock macOS ruleset evaluates, and is flushed when the session ends.
 */

export const LOCAL_EGRESS_PF_ANCHOR = 'com.apple/eas-local-egress';
const INVENTORY_SAMPLE_INTERVAL_MS = 2_000;
const INVENTORY_LOG_LIMIT = 300;
/**
 * pflog reports a flow on its first packet, before the sampler can have seen
 * the socket. Flows wait this long before being called unattributed, so a
 * worker connection that lives a couple of seconds is still credited to it.
 */
export const PFLOG_ATTRIBUTION_GRACE_MS = 5_000;

/**
 * Rules for the inventory anchor. `pass ... log (user)` logs the packet that
 * creates state, so one line per connection, with the owning uid and pid in the
 * pflog header. Loopback peers are the proxy and the forwarded ports, which are
 * the intended path, so they are excluded.
 */
export function buildInventoryAnchorRules({ uid }: { uid: number }): string {
  return [
    `pass out log (user) inet proto tcp from any to ! 127.0.0.0/8 user ${uid}`,
    `pass out log (user) inet proto udp from any to ! 127.0.0.0/8 user ${uid}`,
    `pass out log (user) inet6 proto tcp from any to ! ::1 user ${uid}`,
    `pass out log (user) inet6 proto udp from any to ! ::1 user ${uid}`,
    '',
  ].join('\n');
}

export type PflogFlow = {
  action: string;
  protocol: 'TCP' | 'UDP';
  /** Peer as `host:port`, IPv6 hosts in brackets. */
  remote: string;
  uid: number | null;
  pid: number | null;
};

/**
 * Parse one line of `tcpdump -n -e -ttt -i pflog0`, e.g.
 * `00:00:01.000000 rule 0/0(match): pass out on en0: [uid 501, pid 1234] 10.0.0.5.54321 > 93.184.216.34.443: Flags [S], ...`
 * or `... 2606:4700::1.443: ...` for IPv6. Lines that are not flows return null.
 */
export function parsePflogLine(line: string): PflogFlow | null {
  const header = /rule \S+\(\w+\): (\w+) (?:in|out) on \S+: /.exec(line);
  if (!header) {
    return null;
  }
  const rest = line.slice(header.index + header[0].length);
  const ids = /^\[uid (\d+)(?:, pid (\d+))?\]\s*/.exec(rest);
  const uid = ids ? Number(ids[1]) : null;
  const pid = ids?.[2] ? Number(ids[2]) : null;
  const packet = ids ? rest.slice(ids[0].length) : rest;
  const peers = /^(\S+) > (\S+):\s*(.*)$/.exec(packet);
  if (!peers) {
    return null;
  }
  const dst = peers[2];
  const lastDot = dst.lastIndexOf('.');
  if (lastDot === -1) {
    return null;
  }
  const host = dst.slice(0, lastDot);
  const port = dst.slice(lastDot + 1);
  if (!/^\d+$/.test(port)) {
    return null;
  }
  const tail = peers[3];
  const protocol: 'TCP' | 'UDP' = /\bUDP\b/.test(tail) ? 'UDP' : 'TCP';
  const remote = host.includes(':') ? `[${host}]:${port}` : `${host}:${port}`;
  return { action: header[1], protocol, remote, uid, pid };
}

/**
 * `ps -axo pid=,ppid=,comm=` output to the pids of `rootPid` and every
 * descendant. The worker runs build steps in-process, so its own outbound
 * connections come from this tree; simulator processes hang off launchd_sim
 * instead and are never in it.
 */
export function collectDescendantProcessIds(psOutput: string, rootPid: number): number[] {
  const childrenByParent = new Map<number, number[]>();
  for (const line of psOutput.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+/.exec(line);
    if (!match) {
      continue;
    }
    const pid = Number(match[1]);
    const parentPid = Number(match[2]);
    const siblings = childrenByParent.get(parentPid) ?? [];
    siblings.push(pid);
    childrenByParent.set(parentPid, siblings);
  }
  const pids = [rootPid];
  const seen = new Set<number>(pids);
  for (let i = 0; i < pids.length; i++) {
    for (const child of childrenByParent.get(pids[i]) ?? []) {
      if (!seen.has(child)) {
        seen.add(child);
        pids.push(child);
      }
    }
  }
  return pids;
}

export type WorkerConnection = {
  pid: number;
  command: string;
  protocol: string;
  remote: string;
};

export type InventoryEntry = {
  source: 'worker' | 'pf';
  protocol: string;
  remote: string;
  /** Process that owns the connection, when known. */
  command: string | null;
  pid: number | null;
};

/**
 * Deduplicates what the sampler and the pflog reader see and decides what is
 * worth one log line. Pure, so the decision logic is testable without pf.
 */
export class LocalEgressInventoryTracker {
  private readonly seen = new Set<string>();
  private readonly workerPeers = new Set<string>();
  private readonly commandsByPid = new Map<number, string>();
  private readonly pendingFlows: { flow: PflogFlow; at: number }[] = [];
  private logged = 0;
  private suppressed = 0;

  constructor(private readonly limit: number = INVENTORY_LOG_LIMIT) {}

  recordProcessNames(psOutput: string): void {
    for (const line of psOutput.split('\n')) {
      const match = /^\s*(\d+)\s+\d+\s+(\S.*)$/.exec(line);
      if (match) {
        this.commandsByPid.set(Number(match[1]), path.basename(match[2].trim()));
      }
    }
  }

  recordWorkerConnections(connections: WorkerConnection[]): InventoryEntry[] {
    const entries: InventoryEntry[] = [];
    for (const connection of connections) {
      this.workerPeers.add(`${connection.protocol} ${connection.remote}`);
      const entry: InventoryEntry = {
        source: 'worker',
        protocol: connection.protocol,
        remote: connection.remote,
        command: connection.command,
        pid: connection.pid,
      };
      if (this.admit(`worker ${connection.protocol} ${connection.remote}`)) {
        entries.push(entry);
      }
    }
    return entries;
  }

  /** Queue a pflog flow; `drainPflogFlows` decides on it after the grace period. */
  recordPflogFlow(flow: PflogFlow, at: number = Date.now()): void {
    this.pendingFlows.push({ flow, at });
  }

  /**
   * Flows older than the grace period that the sampler has not credited to
   * the worker by now. Pass `Infinity` to decide on everything, at shutdown.
   */
  drainPflogFlows(
    now: number = Date.now(),
    graceMs: number = PFLOG_ATTRIBUTION_GRACE_MS
  ): InventoryEntry[] {
    const entries: InventoryEntry[] = [];
    while (this.pendingFlows.length > 0 && now - this.pendingFlows[0].at >= graceMs) {
      const { flow } = this.pendingFlows.shift()!;
      const key = `${flow.protocol} ${flow.remote}`;
      if (this.workerPeers.has(key)) {
        continue;
      }
      const command = flow.pid === null ? null : (this.commandsByPid.get(flow.pid) ?? null);
      if (this.admit(`pf ${key}`)) {
        entries.push({
          source: 'pf',
          protocol: flow.protocol,
          remote: flow.remote,
          command,
          pid: flow.pid,
        });
      }
    }
    return entries;
  }

  /** Distinct peers the worker tree held, for the closing summary. */
  workerPeerList(): string[] {
    return [...this.workerPeers].sort();
  }

  suppressedCount(): number {
    return this.suppressed;
  }

  private admit(key: string): boolean {
    if (this.seen.has(key)) {
      return false;
    }
    this.seen.add(key);
    if (this.logged >= this.limit) {
      this.suppressed++;
      return false;
    }
    this.logged++;
    return true;
  }
}

function remoteHostOf(remote: string): string {
  if (remote.startsWith('[')) {
    const end = remote.indexOf(']');
    return end === -1 ? remote : remote.slice(1, end);
  }
  const colon = remote.lastIndexOf(':');
  return colon === -1 ? remote : remote.slice(0, colon);
}

/**
 * Parse `lsof -nP -i -F pcPnT` for the given pids: connected TCP and UDP
 * sockets to peers outside loopback.
 */
export function parseWorkerConnections(
  lsofOutput: string,
  pids: ReadonlySet<number>
): WorkerConnection[] {
  const connections: WorkerConnection[] = [];
  let pid: number | null = null;
  let command = '';
  let protocol: string | null = null;
  let name: string | null = null;
  let tcpState: string | null = null;
  const flush = (): void => {
    if (pid !== null && pids.has(pid) && protocol && name) {
      const arrow = name.indexOf('->');
      const remote = arrow === -1 ? null : name.slice(arrow + 2);
      const active =
        protocol !== 'TCP' ||
        tcpState === null ||
        tcpState === 'ESTABLISHED' ||
        tcpState === 'SYN_SENT';
      const host = remote ? remoteHostOf(remote) : '';
      if (remote && active && !host.startsWith('127.') && host !== '::1' && host !== 'localhost') {
        connections.push({ pid, command, protocol, remote });
      }
    }
    protocol = null;
    name = null;
    tcpState = null;
  };
  for (const line of lsofOutput.split('\n')) {
    const field = line[0];
    const value = line.slice(1);
    if (field === 'p') {
      flush();
      pid = Number(value);
      command = '';
    } else if (field === 'c') {
      command = value;
    } else if (field === 'f') {
      flush();
    } else if (field === 'P') {
      protocol = value;
    } else if (field === 'n') {
      name = value;
    } else if (field === 'T' && value.startsWith('ST=')) {
      tcpState = value.slice('ST='.length);
    }
  }
  flush();
  return connections;
}

const reverseLookups = new Map<string, Promise<string | null>>();

async function reverseLookupAsync(host: string): Promise<string | null> {
  let pending = reverseLookups.get(host);
  if (!pending) {
    pending = dns
      .reverse(host)
      .then(names => names[0] ?? null)
      .catch(() => null);
    reverseLookups.set(host, pending);
  }
  return await pending;
}

async function describeEntryAsync(entry: InventoryEntry): Promise<string> {
  const name = await reverseLookupAsync(remoteHostOf(entry.remote));
  const peer = name ? `${entry.remote} (${name})` : entry.remote;
  const owner =
    entry.command && entry.pid !== null
      ? `${entry.command} (pid ${entry.pid})`
      : entry.pid !== null
        ? `pid ${entry.pid}`
        : 'an unattributed process';
  return entry.source === 'worker'
    ? `Local egress inventory: worker process ${owner} holds a ${entry.protocol} connection to ${peer}.`
    : `Local egress inventory: pf logged a ${entry.protocol} flow to ${peer} from ${owner}; not held by the worker process tree, so it is likely a simulator process bypassing the proxy.`;
}

async function runSudoAsync(args: string[], env: BuildStepEnv): Promise<string> {
  const result = await spawn('sudo', ['-n', ...args], { env, stdio: 'pipe' });
  return result.stdout;
}

export type LocalEgressInventoryHandle = {
  stopAsync: () => Promise<void>;
};

/**
 * Load the log-only anchor, start reading pflog0 and sampling the worker's
 * own connections. Logs each distinct destination once. The returned handle
 * flushes the anchor and stops both readers; the caller runs it from the
 * session cleanup. Any failure here is the caller's to log as a warning: the
 * inventory is observation only and must never fail the session.
 */
export async function startLocalEgressInventoryAsync({
  env,
  logger,
  uid = process.getuid?.() ?? -1,
  rootPid = process.pid,
}: {
  env: BuildStepEnv;
  logger: bunyan;
  uid?: number;
  rootPid?: number;
}): Promise<LocalEgressInventoryHandle> {
  if (uid < 0) {
    throw new Error('Could not determine the worker uid for the local egress inventory.');
  }
  const tracker = new LocalEgressInventoryTracker();
  const rulesPath = path.join(os.tmpdir(), `eas-local-egress-inventory-${process.pid}.conf`);
  await fs.promises.writeFile(rulesPath, buildInventoryAnchorRules({ uid }), 'utf8');
  await runSudoAsync(['pfctl', '-q', '-a', LOCAL_EGRESS_PF_ANCHOR, '-f', rulesPath], env);
  let enabledPf = false;
  try {
    await runSudoAsync(['pfctl', '-q', '-E'], env);
    enabledPf = true;
  } catch (err) {
    logger.warn(
      { err },
      'Local egress inventory: could not enable pf; the anchor is loaded but idle.'
    );
  }
  try {
    await runSudoAsync(['ifconfig', 'pflog0', 'create'], env);
  } catch {
    // Already exists.
  }

  const tcpdump = spawn('sudo', ['-n', 'tcpdump', '-l', '-n', '-e', '-ttt', '-i', 'pflog0'], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  tcpdump.catch(() => {});
  let stopped = false;
  const logEntryAsync = async (entry: InventoryEntry): Promise<void> => {
    logger.info(await describeEntryAsync(entry));
  };
  if (tcpdump.child.stdout) {
    const lines = readline.createInterface({ input: tcpdump.child.stdout });
    lines.on('line', line => {
      const flow = parsePflogLine(line);
      if (flow && !stopped) {
        tracker.recordPflogFlow(flow);
      }
    });
  }
  const drainAsync = async (now?: number): Promise<void> => {
    for (const entry of tracker.drainPflogFlows(now)) {
      await logEntryAsync(entry);
    }
  };

  const sampleAsync = async (): Promise<void> => {
    const ps = await spawn('ps', ['-axo', 'pid=,ppid=,comm='], { env, stdio: 'pipe' });
    tracker.recordProcessNames(ps.stdout);
    const pids = collectDescendantProcessIds(ps.stdout, rootPid);
    let lsofOutput: string;
    try {
      const lsof = await spawn('lsof', ['-nP', '-i', '-F', 'pcPnT', '-a', '-p', pids.join(',')], {
        env,
        stdio: 'pipe',
      });
      lsofOutput = lsof.stdout;
    } catch (err) {
      // lsof exits 1 when no listed process holds a socket; stdout is still valid.
      const result = err as { status?: number | null; stdout?: string };
      if (result.status !== 1) {
        throw err;
      }
      lsofOutput = result.stdout ?? '';
    }
    for (const entry of tracker.recordWorkerConnections(
      parseWorkerConnections(lsofOutput, new Set(pids))
    )) {
      await logEntryAsync(entry);
    }
  };
  // Sample once right away so flows logged during boot have a baseline, then
  // keep sampling; decide on queued pflog flows after each sample.
  let sampling: Promise<void> = sampleAsync().catch(err => {
    logger.debug({ err }, 'Local egress inventory: sampling the worker process tree failed.');
  });
  const timer = setInterval(() => {
    sampling = sampling
      .then(sampleAsync)
      .catch(err => {
        logger.debug({ err }, 'Local egress inventory: sampling the worker process tree failed.');
      })
      .then(() => drainAsync());
  }, INVENTORY_SAMPLE_INTERVAL_MS);
  timer.unref();

  logger.info(
    `Local egress inventory: logging every non-loopback TCP and UDP flow from uid ${uid} through pf anchor ${LOCAL_EGRESS_PF_ANCHOR} (log only, nothing is blocked) and sampling the worker's own connections every ${INVENTORY_SAMPLE_INTERVAL_MS / 1000}s.`
  );

  return {
    stopAsync: async () => {
      if (stopped) {
        return;
      }
      stopped = true;
      clearInterval(timer);
      await sampling.catch(() => {});
      // One last sample, then decide on everything still queued.
      await sampleAsync().catch(() => {});
      await drainAsync(Infinity);
      if (tcpdump.child.pid !== undefined) {
        await runSudoAsync(['kill', String(tcpdump.child.pid)], env).catch(() => {});
      }
      await runSudoAsync(['pfctl', '-q', '-a', LOCAL_EGRESS_PF_ANCHOR, '-F', 'all'], env).catch(
        err => {
          logger.warn(
            { err },
            `Local egress inventory: could not flush pf anchor ${LOCAL_EGRESS_PF_ANCHOR}.`
          );
        }
      );
      if (enabledPf) {
        await runSudoAsync(['pfctl', '-q', '-X'], env).catch(() => {});
      }
      await fs.promises.rm(rulesPath, { force: true });
      const peers = tracker.workerPeerList();
      logger.info(
        `Local egress inventory: the worker process tree held connections to ${peers.length} distinct peer(s)${
          peers.length ? `: ${peers.join(', ')}` : ''
        }.${tracker.suppressedCount() ? ` ${tracker.suppressedCount()} further distinct destinations were not logged.` : ''}`
      );
    },
  };
}
