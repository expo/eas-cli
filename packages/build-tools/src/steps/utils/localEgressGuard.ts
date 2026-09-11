import { SystemError } from '@expo/eas-build-job';
import { type bunyan } from '@expo/logger';
import spawn from '@expo/turtle-spawn';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { IosSimulatorUtils, type IosSimulatorUuid } from '../../utils/IosSimulatorUtils';

import {
  LOCAL_EGRESS_HANDOFF_PATH,
  buildLocalEgressSimulatorEnvironment,
  collectSimulatorProcessIds,
  readLocalEgressHandoffAsync,
} from './localEgress';

/**
 * Worker side of the local egress guard: a dylib injected into every process
 * the simulator launches, which refuses connections that do not go to
 * loopback (where the proxy and the `--egress-allow` forwards live) and
 * records one event per destination per process. This module installs it
 * through the simulator's launchd environment and relays its events into the
 * session log. See resources/egress-guard/README.md.
 */

export const EGRESS_GUARD_LIBRARY_FILE = 'egress-guard.dylib';
export const EGRESS_GUARD_CHECK_FILE = 'egress-guard-check';
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

const PACKAGED_BIN_DIR = path.join(__dirname, '..', '..', '..', 'bin');

async function resolvePackagedFileAsync(binDir: string, file: string): Promise<string | null> {
  const filePath = path.join(binDir, file);
  try {
    await fs.promises.access(filePath);
    return filePath;
  } catch {
    return null;
  }
}

/** The packaged library, next to the compiled package like record-sim. */
export async function resolveEgressGuardLibraryAsync(
  binDir: string = PACKAGED_BIN_DIR
): Promise<string | null> {
  return await resolvePackagedFileAsync(binDir, EGRESS_GUARD_LIBRARY_FILE);
}

/** The packaged self-check binary, built alongside the library. */
export async function resolveEgressGuardCheckAsync(
  binDir: string = PACKAGED_BIN_DIR
): Promise<string | null> {
  return await resolvePackagedFileAsync(binDir, EGRESS_GUARD_CHECK_FILE);
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
    if (event.process === EGRESS_GUARD_CHECK_FILE) {
      // The self-check deliberately trips the guard once; not a bypass.
      return;
    }
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

/**
 * The environment the simulator's launchd must have from its first process:
 * the guard and the proxy variables. Pass it to `IosSimulatorUtils.bootAsync`,
 * which hands it to launchd before anything is spawned; `launchctl setenv`
 * after boot only reaches later processes. Returns null when no local egress
 * session is active. Throws when the guard library is not packaged, since a
 * local egress session without it would silently leak.
 */
export async function resolveLocalEgressBootEnvironmentAsync({
  handoffPath = LOCAL_EGRESS_HANDOFF_PATH,
  libraryPath,
  logPath = LOCAL_EGRESS_GUARD_LOG_PATH,
  mode = 'block',
}: {
  handoffPath?: string;
  /** Explicit library path, `null` for "not available"; resolved from the package when omitted. */
  libraryPath?: string | null;
  logPath?: string;
  mode?: EgressGuardMode;
} = {}): Promise<Record<string, string> | null> {
  const handoff = await readLocalEgressHandoffAsync(handoffPath);
  if (!handoff) {
    return null;
  }
  const resolvedLibrary =
    libraryPath === undefined ? await resolveEgressGuardLibraryAsync() : libraryPath;
  if (!resolvedLibrary) {
    throw new SystemError(
      'The local egress guard library is not available on this device host, so this local egress session ' +
        'cannot guarantee that connections bypassing the system proxy are refused. The device host image is ' +
        'missing bin/egress-guard.dylib; this is a service problem, please contact support.'
    );
  }
  return {
    ...buildGuardLaunchdEnvironment({ libraryPath: resolvedLibrary, logPath, mode }),
    ...buildLocalEgressSimulatorEnvironment(handoff.port),
  };
}

type ActiveRelay = { tailer: GuardLogTailer; relay: GuardEventRelay };
const activeRelays = new Map<string, ActiveRelay>();

/**
 * Install the guard into a simulator when a local egress session is active,
 * and start relaying its events into the session log. Returns false when
 * there is no local egress session. Throws when the library is not packaged
 * or launchd could not be configured: a local egress session without the
 * guard would silently leak, so it must not start. Only an unwritable event
 * log is a warning, since refusals still happen and only reporting is lost.
 *
 * Call this as soon as `simctl boot` returns: launchd is up and nothing else
 * has started, so every process the boot spawns inherits the guard. Verify
 * with `verifyLocalEgressGuardAsync` once boot completes.
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
    throw new SystemError(
      'The local egress guard library is not available on this device host, so this local egress session ' +
        'cannot guarantee that connections bypassing the system proxy are refused. The device host image is ' +
        'missing bin/egress-guard.dylib; this is a service problem, please contact support.'
    );
  }

  await logAlreadyRunningProcessesAsync({ env, logger });

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
    throw new SystemError(
      'Could not install the local egress guard in the Simulator (launchctl setenv failed), so this local ' +
        'egress session cannot guarantee that connections bypassing the system proxy are refused. Retry the ' +
        'session; if it keeps failing, please contact support.',
      { cause: err }
    );
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

/**
 * Processes the simulator already runs when the guard is installed never get
 * it. Right after `simctl boot` that is nothing; later it is SpringBoard and
 * the early daemons, which follow the system proxy anyway. Log them so the
 * uncovered set is visible rather than assumed.
 */
async function logAlreadyRunningProcessesAsync({
  env,
  logger,
}: {
  env: NodeJS.ProcessEnv;
  logger: bunyan;
}): Promise<void> {
  let psOutput = '';
  try {
    psOutput = (await spawn('ps', ['-axo', 'pid=,ppid=,comm='], { env, stdio: 'pipe' })).stdout;
  } catch {
    return;
  }
  const pids = new Set(collectSimulatorProcessIds(psOutput));
  const names = new Set<string>();
  for (const line of psOutput.split('\n')) {
    const match = /^\s*(\d+)\s+\d+\s+(\S.*)$/.exec(line);
    if (match && pids.has(Number(match[1]))) {
      names.add(path.basename(match[2].trim()));
    }
  }
  if (names.size === 0) {
    logger.info(
      'Local egress guard: no simulator process was running before the guard was installed.'
    );
    return;
  }
  const listed = [...names].sort();
  const shown =
    listed.slice(0, 20).join(', ') + (listed.length > 20 ? `, and ${listed.length - 20} more` : '');
  logger.info(
    `Local egress guard: ${names.size} simulator process(es) were already running before the guard was installed and are not covered by it: ${shown}.`
  );
}

/**
 * launchd's trampoline exists for milliseconds between fork and exec of the
 * real service, with nothing mapped yet; it never makes a connection itself.
 */
const COVERAGE_IGNORED_PROCESSES = new Set(['xpcproxy_sim']);

export type GuardCoverage = {
  /** Simulator processes with the guard library mapped. */
  covered: string[];
  /** Simulator processes without it: started before the guard was installed. */
  uncovered: string[];
  /** Pids behind `uncovered`, for comparing samples. */
  uncoveredPids: number[];
};

/**
 * Which simulator processes have the guard library mapped, from
 * `ps -axo pid=,ppid=,comm=` and `lsof -nP -a -p <pids> -d txt -F pn` output.
 * A process is covered when any of its mapped images is the guard library.
 */
export function parseGuardCoverage(psOutput: string, lsofOutput: string): GuardCoverage {
  const simulatorPids = new Set(collectSimulatorProcessIds(psOutput));
  const commandsByPid = new Map<number, string>();
  for (const line of psOutput.split('\n')) {
    const match = /^\s*(\d+)\s+\d+\s+(\S.*)$/.exec(line);
    if (match) {
      commandsByPid.set(Number(match[1]), path.basename(match[2].trim()));
    }
  }
  const loaded = new Set<number>();
  let pid: number | null = null;
  for (const line of lsofOutput.split('\n')) {
    if (line[0] === 'p') {
      pid = Number(line.slice(1));
    } else if (line[0] === 'n' && pid !== null && line.endsWith(EGRESS_GUARD_LIBRARY_FILE)) {
      loaded.add(pid);
    }
  }
  const covered: string[] = [];
  const uncovered: string[] = [];
  const uncoveredPids: number[] = [];
  for (const simulatorPid of simulatorPids) {
    const name = commandsByPid.get(simulatorPid) ?? String(simulatorPid);
    if (COVERAGE_IGNORED_PROCESSES.has(name)) {
      continue;
    }
    if (loaded.has(simulatorPid)) {
      covered.push(name);
    } else {
      uncovered.push(name);
      uncoveredPids.push(simulatorPid);
    }
  }
  covered.sort();
  uncovered.sort();
  return { covered, uncovered, uncoveredPids };
}

/**
 * A process caught between fork and exec has nothing mapped yet and looks
 * uncovered for an instant. Two samples a moment apart separate those from
 * processes that really run without the guard: only pids uncovered in both
 * count, reported with the later sample's names.
 */
export function mergeGuardCoverageSamples(
  first: GuardCoverage,
  second: GuardCoverage
): GuardCoverage {
  const persistent = new Set(first.uncoveredPids.filter(pid => second.uncoveredPids.includes(pid)));
  const uncovered: string[] = [];
  const uncoveredPids: number[] = [];
  second.uncoveredPids.forEach((pid, index) => {
    if (persistent.has(pid)) {
      uncovered.push(second.uncovered[index]);
      uncoveredPids.push(pid);
    }
  });
  return { covered: second.covered, uncovered, uncoveredPids };
}

/**
 * Measure and log guard coverage across the simulator's processes. Observation
 * only: the uncovered set is whatever started before the guard was installed,
 * which is nothing when installation runs right after `simctl boot`.
 */
export async function reportLocalEgressGuardCoverageAsync({
  env,
  logger,
  sampleIntervalMs = 1_000,
}: {
  env: NodeJS.ProcessEnv;
  logger: bunyan;
  sampleIntervalMs?: number;
}): Promise<GuardCoverage | null> {
  const first = await sampleGuardCoverageAsync({ env });
  if (!first) {
    return null;
  }
  await new Promise(resolve => setTimeout(resolve, sampleIntervalMs));
  const second = await sampleGuardCoverageAsync({ env });
  const coverage = second ? mergeGuardCoverageSamples(first, second) : first;
  const total = coverage.covered.length + coverage.uncovered.length;
  if (coverage.uncovered.length === 0) {
    logger.info(
      `Local egress guard coverage: all ${total} simulator process(es) have the guard loaded.`
    );
  } else {
    const shown =
      coverage.uncovered.slice(0, 20).join(', ') +
      (coverage.uncovered.length > 20 ? `, and ${coverage.uncovered.length - 20} more` : '');
    logger.info(
      `Local egress guard coverage: ${coverage.covered.length} of ${total} simulator process(es) have the guard loaded. Not covered, started before the guard was installed: ${shown}.`
    );
  }
  return coverage;
}

async function sampleGuardCoverageAsync({
  env,
}: {
  env: NodeJS.ProcessEnv;
}): Promise<GuardCoverage | null> {
  let psOutput: string;
  try {
    psOutput = (await spawn('ps', ['-axo', 'pid=,ppid=,comm='], { env, stdio: 'pipe' })).stdout;
  } catch {
    return null;
  }
  const pids = collectSimulatorProcessIds(psOutput);
  if (pids.length === 0) {
    return null;
  }
  let lsofOutput: string;
  try {
    lsofOutput = (
      await spawn('lsof', ['-nP', '-a', '-p', pids.join(','), '-d', 'txt', '-F', 'pn'], {
        env,
        stdio: 'pipe',
      })
    ).stdout;
  } catch (err) {
    // lsof exits 1 when some listed pid has already exited; stdout is still valid.
    const result = err as { status?: number | null; stdout?: string };
    if (result.status !== 1) {
      return null;
    }
    lsofOutput = result.stdout ?? '';
  }
  return parseGuardCoverage(psOutput, lsofOutput);
}

/**
 * Run the packaged self-check inside the simulator: it must find the guard
 * loaded in a fresh process and see it behave as `mode` says. Throws when the
 * check binary is missing or the check fails, which fails the session.
 */
export async function verifyLocalEgressGuardAsync({
  udid,
  env,
  logger,
  mode = 'block',
  checkPath,
}: {
  udid: IosSimulatorUuid;
  env: NodeJS.ProcessEnv;
  logger: bunyan;
  mode?: EgressGuardMode;
  /** Explicit check binary path, `null` for "not available"; resolved from the package when omitted. */
  checkPath?: string | null;
}): Promise<void> {
  const resolvedCheck = checkPath === undefined ? await resolveEgressGuardCheckAsync() : checkPath;
  if (!resolvedCheck) {
    throw new SystemError(
      'The local egress guard self-check is not available on this device host, so this session cannot ' +
        'verify that the guard is in effect. The device host image is missing bin/egress-guard-check; ' +
        'this is a service problem, please contact support.'
    );
  }
  let output: string;
  try {
    const result = await spawn('xcrun', ['simctl', 'spawn', udid, resolvedCheck, '--mode', mode], {
      env,
      stdio: 'pipe',
    });
    output = result.stdout.trim();
  } catch (err) {
    const failed = err as { status?: number | null; stdout?: string; stderr?: string };
    const detail = [failed.stdout, failed.stderr].filter(Boolean).join('\n').trim();
    throw new SystemError(
      'The local egress guard is not in effect in the Simulator: the self-check run right after boot ' +
        `failed${failed.status != null ? ` (exit ${failed.status})` : ''}. Connections that bypass the ` +
        'system proxy would leave from the device host, so the session was stopped. Retry the session; if it ' +
        `keeps failing, please contact support.${detail ? ` Self-check output: ${detail}` : ''}`,
      { cause: err }
    );
  }
  logger.info(`Local egress guard verified in the Simulator: ${output || 'self-check passed'}.`);
  await reportLocalEgressGuardCoverageAsync({ env, logger });
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
