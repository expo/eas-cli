import { SystemError } from '@expo/eas-build-job';
import type { bunyan } from '@expo/logger';

const GUARD_RELAY_LOG_LIMIT = 200;
const GUARD_OVERFLOW_FUNCTION = 'overflow';

export type GuardEvent = {
  process: string;
  /** Null when the event source cannot attribute the attempt to a process id. */
  pid: number | null;
  function: string;
  action: 'blocked' | 'logged';
  peer: string;
  /** Image names above the interposer, innermost first. */
  callers: string[];
  note?: string;
};

export class GuardEventRelay {
  private readonly seen = new Set<string>();
  private readonly peers = new Set<string>();
  private readonly processes = new Set<string>();
  private blocked = 0;
  private logged = 0;
  private suppressed = 0;
  private logger: bunyan;

  constructor(
    logger: bunyan,
    private readonly limit: number = GUARD_RELAY_LOG_LIMIT
  ) {
    this.logger = logger;
  }

  /**
   * Log through a different step's logger from now on. Refusals happen for
   * the life of the session, so they belong to the step that runs the
   * session, not the one that booted the simulator minutes earlier.
   */
  setLogger(logger: bunyan): void {
    this.logger = logger;
  }

  handle(event: GuardEvent): void {
    if (event.function === GUARD_OVERFLOW_FUNCTION) {
      const verb = event.action === 'blocked' ? 'refused' : 'observed';
      this.logger.info(
        `Local egress guard: ${event.process} (pid ${event.pid}) reached the limit of ${event.peer} listed per process; further distinct destinations from it are ${verb} but not listed.`
      );
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
    const pid = event.pid === null ? '' : ` (pid ${event.pid})`;
    const callers = event.callers.length ? `; callers: ${event.callers.join(', ')}` : '';
    const note = event.note ? ` (${event.note})` : '';
    this.logger.info(
      `Local egress guard: ${verb} ${event.function} from ${event.process}${pid} to ${event.peer}${note}${callers}`
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

type ActiveRelay = {
  source: { stopAsync: () => Promise<void> };
  relay: GuardEventRelay;
  onRebind?: (logger: bunyan) => void;
  afterSummaryAsync?: () => Promise<void>;
};
const activeRelays = new Map<string, ActiveRelay>();

export function registerLocalEgressGuardRelay(key: string, entry: ActiveRelay): void {
  if (activeRelays.has(key)) {
    throw new SystemError(`A local egress guard relay is already registered for ${key}.`);
  }
  activeRelays.set(key, entry);
}

/**
 * Attribute guard events to the step that runs the session from now on. The
 * relay starts under the simulator boot step's logger; once the session step
 * takes over, its lines should appear under that step in the job log, next
 * to the rest of the session's output, rather than under a step that already
 * finished.
 */
export function rebindLocalEgressGuardRelays(logger: bunyan): void {
  for (const { relay, onRebind } of activeRelays.values()) {
    relay.setLogger(logger);
    onRebind?.(logger);
  }
}

/** Stop relaying and write each relay's summary; called from the session cleanup. */
export async function stopLocalEgressGuardRelaysAsync(logger: bunyan): Promise<void> {
  const relays = [...activeRelays.values()];
  activeRelays.clear();
  for (const { source, relay, afterSummaryAsync } of relays) {
    try {
      await source.stopAsync();
    } catch (err) {
      logger.warn(
        { err },
        'Local egress guard: could not read the last events from the guard log.'
      );
    }
    relay.logSummary();
    await afterSummaryAsync?.().catch(err =>
      logger.warn({ err }, 'Local egress guard: could not report the final totals.')
    );
  }
}
