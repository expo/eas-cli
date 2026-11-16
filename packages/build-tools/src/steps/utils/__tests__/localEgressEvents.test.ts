import type { bunyan } from '@expo/logger';
import {
  GuardEventRelay,
  rebindLocalEgressGuardRelays,
  registerLocalEgressGuardRelay,
  stopLocalEgressGuardRelaysAsync,
} from '../localEgressEvents';

function createLogger(): bunyan & { lines: { level: string; msg: string }[] } {
  const lines: { level: string; msg: string }[] = [];
  const record = (level: string) => (a: unknown, b?: unknown) =>
    lines.push({ level, msg: typeof a === 'string' ? a : String(b) });
  return { info: record('info'), warn: record('warn'), debug: record('debug'), lines } as any;
}

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

  it('omits the pid when the source has none and appends a note', () => {
    const logger = createLogger();
    const relay = new GuardEventRelay(logger);
    relay.handle({
      process: 'Android emulator',
      pid: null,
      function: 'udp',
      action: 'blocked',
      peer: '142.250.152.94:443',
      callers: [],
      note: 'QUIC',
    });
    expect(logger.lines.map(l => l.msg)).toEqual([
      'Local egress guard: refused udp from Android emulator to 142.250.152.94:443 (QUIC)',
    ]);
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

  it('explains a process that filled its table instead of counting it as a destination', () => {
    const logger = createLogger();
    const relay = new GuardEventRelay(logger);
    relay.handle(blocked('MyApp', '1.1.1.1:443'));
    relay.handle({
      ...blocked('MyApp', '128 distinct destinations'),
      function: 'overflow',
      callers: [],
    });
    expect(logger.lines.at(-1)?.msg).toContain(
      'MyApp (pid 1) reached the limit of 128 distinct destinations listed per process; further distinct destinations from it are refused but not listed'
    );
    expect(relay.summary()).toEqual({ blocked: 1, logged: 0, distinct: 1, suppressed: 0 });
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

it('rebinds Android events and drains the source and final summary exactly once', async () => {
  const original = createLogger();
  const session = createLogger();
  const relay = new GuardEventRelay(original);
  const stopAsync = jest.fn().mockResolvedValue(undefined);
  const onRebind = jest.fn();
  const afterSummaryAsync = jest.fn().mockResolvedValue(undefined);
  registerLocalEgressGuardRelay('android', {
    source: { stopAsync },
    relay,
    onRebind,
    afterSummaryAsync,
  });
  rebindLocalEgressGuardRelays(session);
  relay.handle({
    process: 'emulator',
    pid: null,
    function: 'connect',
    action: 'blocked',
    peer: '203.0.113.1:443',
    callers: [],
  });
  await stopLocalEgressGuardRelaysAsync(session);
  await stopLocalEgressGuardRelaysAsync(session);
  expect(onRebind).toHaveBeenCalledWith(session);
  expect(original.lines).toHaveLength(0);
  expect(session.lines.some(line => line.msg.includes('refused connect'))).toBe(true);
  expect(session.lines.some(line => line.msg.includes('refused 1 connection attempt'))).toBe(true);
  expect(stopAsync).toHaveBeenCalledTimes(1);
  expect(afterSummaryAsync).toHaveBeenCalledTimes(1);
});
