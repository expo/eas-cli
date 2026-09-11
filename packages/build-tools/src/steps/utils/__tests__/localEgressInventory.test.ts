import {
  LOCAL_EGRESS_PF_ANCHOR,
  LocalEgressInventoryTracker,
  PFLOG_ATTRIBUTION_GRACE_MS,
  buildInventoryAnchorRules,
  collectDescendantProcessIds,
  parsePflogLine,
  parseWorkerConnections,
} from '../localEgressInventory';

describe(buildInventoryAnchorRules, () => {
  it('logs, never blocks, only for the given uid, and skips loopback', () => {
    const rules = buildInventoryAnchorRules({ uid: 501 });
    expect(rules).toBe(
      [
        'pass out log (user) inet proto tcp from any to ! 127.0.0.0/8 user 501',
        'pass out log (user) inet proto udp from any to ! 127.0.0.0/8 user 501',
        'pass out log (user) inet6 proto tcp from any to ! ::1 user 501',
        'pass out log (user) inet6 proto udp from any to ! ::1 user 501',
        '',
      ].join('\n')
    );
    expect(rules).not.toMatch(/block/);
  });

  it('keeps the anchor under the wildcard the stock ruleset evaluates', () => {
    expect(LOCAL_EGRESS_PF_ANCHOR.startsWith('com.apple/')).toBe(true);
  });
});

describe(parsePflogLine, () => {
  it('parses a TCP flow with uid and pid', () => {
    expect(
      parsePflogLine(
        '00:00:01.000000 rule 0/0(match): pass out on en0: [uid 501, pid 4242] 10.0.0.5.54321 > 93.184.216.34.443: Flags [S], seq 1, win 65535, length 0'
      )
    ).toEqual({
      action: 'pass',
      protocol: 'TCP',
      remote: '93.184.216.34:443',
      uid: 501,
      pid: 4242,
    });
  });

  it('parses a UDP flow without ids', () => {
    expect(
      parsePflogLine(
        '00:00:00.000100 rule 0/0(match): pass out on en0: 10.0.0.5.60000 > 8.8.8.8.53: UDP, length 40'
      )
    ).toEqual({ action: 'pass', protocol: 'UDP', remote: '8.8.8.8:53', uid: null, pid: null });
  });

  it('parses an IPv6 peer into bracket form', () => {
    expect(
      parsePflogLine(
        '00:00:00.000100 rule 0/0(match): block out on en0: [uid 501] 2001:db8::5.50000 > 2606:4700::1.443: Flags [S], length 0'
      )
    ).toEqual({
      action: 'block',
      protocol: 'TCP',
      remote: '[2606:4700::1]:443',
      uid: 501,
      pid: null,
    });
  });

  it('ignores lines that are not flows', () => {
    expect(parsePflogLine('tcpdump: listening on pflog0, link-type PFLOG')).toBeNull();
    expect(parsePflogLine('')).toBeNull();
  });
});

describe(collectDescendantProcessIds, () => {
  const ps = [
    '    1     0 /sbin/launchd',
    ' 3758     1 node',
    ' 3801  3758 xcrun',
    ' 3802  3801 simctl',
    ' 4000     1 launchd_sim',
    ' 4001  4000 SpringBoard',
    ' 4100  3758 bun',
  ].join('\n');

  it('returns the root and every descendant, not simulator processes', () => {
    expect(collectDescendantProcessIds(ps, 3758).sort()).toEqual([3758, 3801, 3802, 4100].sort());
  });

  it('returns only the root when it has no children', () => {
    expect(collectDescendantProcessIds(ps, 4001)).toEqual([4001]);
  });
});

describe(parseWorkerConnections, () => {
  const lsof = [
    'p3758',
    'cnode',
    'f20',
    'PTCP',
    'n10.0.0.5:54000->34.120.1.1:443',
    'TST=ESTABLISHED',
    'f21',
    'PTCP',
    'n127.0.0.1:64051->127.0.0.1:52000',
    'TST=ESTABLISHED',
    'f22',
    'PTCP',
    'n*:49786',
    'TST=LISTEN',
    'p4001',
    'cSpringBoard',
    'f9',
    'PTCP',
    'n10.0.0.5:54100->17.253.1.1:443',
    'TST=ESTABLISHED',
    '',
  ].join('\n');

  it('returns non-loopback connections for the given pids only', () => {
    expect(parseWorkerConnections(lsof, new Set([3758]))).toEqual([
      { pid: 3758, command: 'node', protocol: 'TCP', remote: '34.120.1.1:443' },
    ]);
  });
});

describe(LocalEgressInventoryTracker, () => {
  const ps = [' 3758     1 node', ' 4001  4000 /path/to/SpringBoard'].join('\n');
  const workerFlow = {
    action: 'pass',
    protocol: 'TCP' as const,
    remote: '34.120.1.1:443',
    uid: 501,
    pid: null,
  };
  const connection = { pid: 3758, command: 'node', protocol: 'TCP', remote: '34.120.1.1:443' };

  it('logs a worker connection once and drops pf flows to a peer the worker already holds', () => {
    const tracker = new LocalEgressInventoryTracker();
    expect(tracker.recordWorkerConnections([connection])).toHaveLength(1);
    expect(tracker.recordWorkerConnections([connection])).toHaveLength(0);
    tracker.recordPflogFlow(workerFlow, 1_000);
    expect(tracker.drainPflogFlows(1_000 + PFLOG_ATTRIBUTION_GRACE_MS)).toEqual([]);
    expect(tracker.workerPeerList()).toEqual(['TCP 34.120.1.1:443']);
  });

  it('credits a flow to the worker when the sampler catches up within the grace period', () => {
    const tracker = new LocalEgressInventoryTracker();
    tracker.recordPflogFlow(workerFlow, 1_000);
    // Before the grace period nothing is decided.
    expect(tracker.drainPflogFlows(1_000 + PFLOG_ATTRIBUTION_GRACE_MS - 1)).toEqual([]);
    tracker.recordWorkerConnections([connection]);
    expect(tracker.drainPflogFlows(1_000 + PFLOG_ATTRIBUTION_GRACE_MS)).toEqual([]);
  });

  it('reports a flow the worker never held once the grace period passes, naming the process when the pid is known', () => {
    const tracker = new LocalEgressInventoryTracker();
    tracker.recordProcessNames(ps);
    const flow = { ...workerFlow, remote: '17.253.1.1:443', pid: 4001 };
    tracker.recordPflogFlow(flow, 1_000);
    tracker.recordPflogFlow(flow, 1_500);
    expect(tracker.drainPflogFlows(Infinity)).toEqual([
      {
        source: 'pf',
        protocol: 'TCP',
        remote: '17.253.1.1:443',
        command: 'SpringBoard',
        pid: 4001,
      },
    ]);
  });

  it('stops logging past the limit and counts what it dropped', () => {
    const tracker = new LocalEgressInventoryTracker(1);
    tracker.recordPflogFlow({ ...workerFlow, remote: '1.1.1.1:443' }, 0);
    tracker.recordPflogFlow({ ...workerFlow, remote: '1.1.1.2:443' }, 0);
    expect(tracker.drainPflogFlows(Infinity)).toHaveLength(1);
    expect(tracker.suppressedCount()).toBe(1);
  });
});
