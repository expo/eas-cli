import { type bunyan } from '@expo/logger';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { IosSimulatorUtils, type IosSimulatorUuid } from '../../utils/IosSimulatorUtils';

import { LOCAL_EGRESS_HANDOFF_PATH, readLocalEgressHandoffAsync } from './localEgress';

/**
 * Worker side of the local egress guard: a dylib injected into every process
 * the simulator launches, which refuses connections that do not go to
 * loopback (where the proxy and the `--egress-allow` forwards live) and
 * records one event per destination per process. This module installs it
 * through the simulator's launchd environment and relays its events into the
 * session log. See resources/egress-guard/README.md.
 */

export const EGRESS_GUARD_LIBRARY_FILE = 'egress-guard.dylib';
export const EGRESS_GUARD_LOG_ENV = 'EAS_EGRESS_GUARD_LOG';
export const EGRESS_GUARD_MODE_ENV = 'EAS_EGRESS_GUARD_MODE';
export const LOCAL_EGRESS_GUARD_LOG_PATH = path.join(os.tmpdir(), 'eas-local-egress-guard.log');
const GUARD_EVENT_PREFIX = 'eas-egress-guard';
const GUARD_RELAY_LOG_LIMIT = 200;
const GUARD_TAIL_INTERVAL_MS = 1_000;

export type EgressGuardMode = 'block' | 'log';

export function buildGuardLaunchdEnvironment({
  libraryPath,
  logPath,
  mode,
}: {
  libraryPath: string;
  logPath: string;
  mode: EgressGuardMode;
}): Record<string, string> {
  return {
    DYLD_INSERT_LIBRARIES: libraryPath,
    [EGRESS_GUARD_LOG_ENV]: logPath,
    [EGRESS_GUARD_MODE_ENV]: mode,
  };
}

export type GuardEvent = {
  process: string;
  pid: number;
  function: string;
  action: 'blocked' | 'logged';
  peer: string;
  /** Image names above the interposer, innermost first. */
  callers: string[];
};

/** One tab-separated line written by the guard; see policy.h for the format. */
export function parseGuardLogLine(line: string): GuardEvent | null {
  const fields = line.split('\t');
  if (fields.length < 7 || fields[0] !== GUARD_EVENT_PREFIX) {
    return null;
  }
  const [, process, pidText, fn, action, peer, callerText] = fields;
  const pid = Number(pidText);
  if (!Number.isInteger(pid) || (action !== 'blocked' && action !== 'logged') || !fn || !peer) {
    return null;
  }
  return {
    process,
    pid,
    function: fn,
    action,
    peer,
    callers: callerText ? callerText.split(',').filter(Boolean) : [],
  };
}

/** The packaged library, next to the compiled package like record-sim. */
export async function resolveEgressGuardLibraryAsync(
  binDir: string = path.join(__dirname, '..', '..', '..', 'bin')
): Promise<string | null> {
  const libraryPath = path.join(binDir, EGRESS_GUARD_LIBRARY_FILE);
  try {
    await fs.promises.access(libraryPath);
    return libraryPath;
  } catch {
    return null;
  }
}

/**
 * Turns guard events into session log lines: one line the first time a
 * process reaches a destination through a given call, counts after that, and
 * a summary at the end.
 */
export class GuardEventRelay {
  private readonly seen = new Set<string>();
  private readonly peers = new Set<string>();
  private readonly processes = new Set<string>();
  private blocked = 0;
  private logged = 0;
  private suppressed = 0;

  constructor(
    private readonly logger: bunyan,
    private readonly limit: number = GUARD_RELAY_LOG_LIMIT
  ) {}

  handle(event: GuardEvent): void {
    if (event.action === 'blocked') {
      this.blocked++;
    } else {
      this.logged++;
    }
    this.peers.add(event.peer);
    this.processes.add(event.process);
    const key = `${event.process}|${event.function}|${event.peer}`;
    if (this.seen.has(key)) {
      return;
    }
    this.seen.add(key);
    if (this.seen.size > this.limit) {
      this.suppressed++;
      return;
    }
    const verb = event.action === 'blocked' ? 'refused' : 'observed';
    const callers = event.callers.length ? `; callers: ${event.callers.join(', ')}` : '';
    this.logger.info(
      `Local egress guard: ${verb} ${event.function} from ${event.process} (pid ${event.pid}) to ${event.peer}${callers}`
    );
  }

  summary(): { blocked: number; logged: number; distinct: number; suppressed: number } {
    return {
      blocked: this.blocked,
      logged: this.logged,
      distinct: this.peers.size,
      suppressed: this.suppressed,
    };
  }

  logSummary(): void {
    const { blocked, logged, distinct, suppressed } = this.summary();
    const observed = logged ? ` and observed ${logged} more without refusing` : '';
    const dropped = suppressed
      ? ` ${suppressed} further distinct destination(s) were not logged individually.`
      : '';
    this.logger.info(
      `Local egress guard: refused ${blocked} connection attempt(s) to ${distinct} distinct destination(s) from ${this.processes.size} process(es)${observed}.${dropped}`
    );
  }
}

/**
 * Polls a file the simulator processes append to and delivers whole lines.
 * Tolerates the file not existing yet, partial trailing lines, and truncation.
 */
export class GuardLogTailer {
  private readonly path: string;
  private readonly onLine: (line: string) => void;
  private readonly intervalMs: number;
  private offset = 0;
  private partial = '';
  private timer: NodeJS.Timeout | undefined;
  private reading: Promise<void> = Promise.resolve();

  constructor({
    path: filePath,
    onLine,
    intervalMs = GUARD_TAIL_INTERVAL_MS,
  }: {
    path: string;
    onLine: (line: string) => void;
    intervalMs?: number;
  }) {
    this.path = filePath;
    this.onLine = onLine;
    this.intervalMs = intervalMs;
  }

  start(): void {
    this.timer = setInterval(() => {
      this.reading = this.reading.then(() => this.readAsync()).catch(() => {});
    }, this.intervalMs);
    this.timer.unref();
  }

  async stopAsync(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    await this.reading.catch(() => {});
    await this.readAsync().catch(() => {});
  }

  private async readAsync(): Promise<void> {
    let handle: fs.promises.FileHandle;
    try {
      handle = await fs.promises.open(this.path, 'r');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return;
      }
      throw err;
    }
    try {
      const { size } = await handle.stat();
      if (size < this.offset) {
        // Truncated or replaced; start over.
        this.offset = 0;
        this.partial = '';
      }
      if (size === this.offset) {
        return;
      }
      const buffer = new Uint8Array(size - this.offset);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, this.offset);
      this.offset += bytesRead;
      const text = this.partial + Buffer.from(buffer.buffer, 0, bytesRead).toString('utf8');
      const lines = text.split('\n');
      this.partial = lines.pop() ?? '';
      for (const line of lines) {
        if (line.length > 0) {
          this.onLine(line);
        }
      }
    } finally {
      await handle.close();
    }
  }
}

type ActiveRelay = { tailer: GuardLogTailer; relay: GuardEventRelay };
const activeRelays = new Map<string, ActiveRelay>();

/**
 * Install the guard into a booted simulator when a local egress session is
 * active, and start relaying its events into the session log. Returns false
 * when there is no local egress session, the library is not packaged, or
 * launchd could not be configured. Every failure is a warning that names the
 * consequence; the session itself is never failed here.
 */
export async function installLocalEgressGuardAsync({
  udid,
  env,
  logger,
  handoffPath = LOCAL_EGRESS_HANDOFF_PATH,
  libraryPath,
  logPath = LOCAL_EGRESS_GUARD_LOG_PATH,
  mode = 'block',
  tailIntervalMs,
}: {
  udid: IosSimulatorUuid;
  env: NodeJS.ProcessEnv;
  logger: bunyan;
  handoffPath?: string;
  /** Explicit library path, `null` for "not available"; resolved from the package when omitted. */
  libraryPath?: string | null;
  logPath?: string;
  mode?: EgressGuardMode;
  tailIntervalMs?: number;
}): Promise<boolean> {
  let handoff;
  try {
    handoff = await readLocalEgressHandoffAsync(handoffPath);
  } catch (err) {
    logger.warn(
      { err },
      'Local egress guard: could not read the local egress handoff, so the guard was not installed. ' +
        'Connections that bypass the proxy will exit from this worker.'
    );
    return false;
  }
  if (!handoff) {
    return false;
  }

  const resolvedLibrary =
    libraryPath === undefined ? await resolveEgressGuardLibraryAsync() : libraryPath;
  if (!resolvedLibrary) {
    logger.warn(
      'Local egress guard: the guard library is not available on this device host, so connections that ' +
        'bypass the system proxy will not be refused; they exit from this worker. The session is otherwise unaffected.'
    );
    return false;
  }

  let logWritable = true;
  try {
    await fs.promises.mkdir(path.dirname(logPath), { recursive: true });
    await fs.promises.appendFile(logPath, '');
  } catch (err) {
    logWritable = false;
    logger.warn(
      { err },
      `Local egress guard: could not create ${logPath}, so refused connections will not be reported in this log. They are still refused.`
    );
  }

  try {
    await IosSimulatorUtils.setLaunchdEnvironmentAsync({
      udid,
      env,
      variables: buildGuardLaunchdEnvironment({ libraryPath: resolvedLibrary, logPath, mode }),
    });
  } catch (err) {
    logger.warn(
      { err },
      'Local egress guard: could not install the guard in the Simulator, so connections that bypass the ' +
        'system proxy will not be refused; they exit from this worker. The session is otherwise unaffected.'
    );
    return false;
  }

  if (logWritable && !activeRelays.has(logPath)) {
    const relay = new GuardEventRelay(logger);
    const tailer = new GuardLogTailer({
      path: logPath,
      intervalMs: tailIntervalMs,
      onLine: line => {
        const event = parseGuardLogLine(line);
        if (event) {
          relay.handle(event);
        }
      },
    });
    tailer.start();
    activeRelays.set(logPath, { tailer, relay });
  }

  logger.info(
    `Local egress guard installed in the Simulator (mode ${mode}): connections that bypass the system proxy are ${
      mode === 'block' ? 'refused' : 'observed'
    } in the process that makes them and reported here as they happen.`
  );
  return true;
}

/** Stop relaying and write each relay's summary; called from the session cleanup. */
export async function stopLocalEgressGuardRelaysAsync(logger: bunyan): Promise<void> {
  const relays = [...activeRelays.values()];
  activeRelays.clear();
  for (const { tailer, relay } of relays) {
    try {
      await tailer.stopAsync();
    } catch (err) {
      logger.warn(
        { err },
        'Local egress guard: could not read the last events from the guard log.'
      );
    }
    relay.logSummary();
  }
}
