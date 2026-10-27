import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { createMockLogger } from '../../../__tests__/utils/logger';
import {
  buildEgressFenceRuleset,
  findProcessesOutsideScope,
  getCgroupLevel,
  listEmulatorProcessesAsync,
  parseAdbReversePorts,
  parseConnectAuthority,
  parseFenceCounters,
  parseFenceLogLine,
  parseLoopbackListenerPorts,
  resolveAndroidEmulatorLocalEgressAsync,
  startLocalEgressRelayAsync,
} from '../androidLocalEgress';
import { writeLocalEgressHandoffAsync } from '../localEgress';

describe(parseConnectAuthority, () => {
  it('parses IPv4, hostname and bracketed IPv6 authorities', () => {
    expect(parseConnectAuthority('CONNECT 192.0.2.1:443 HTTP/1.1\r\nHost: x\r\n')).toEqual({
      host: '192.0.2.1',
      port: 443,
    });
    expect(parseConnectAuthority('CONNECT Example.com:8443 HTTP/1.0\r\n')).toEqual({
      host: 'example.com',
      port: 8443,
    });
    expect(parseConnectAuthority('CONNECT [2001:db8::1]:443 HTTP/1.1\r\n')).toEqual({
      host: '2001:db8::1',
      port: 443,
    });
  });

  it('ignores requests that are not CONNECT', () => {
    expect(parseConnectAuthority('GET http://example.com/ HTTP/1.1\r\n')).toBeNull();
  });
});

describe(buildEgressFenceRuleset, () => {
  it('refuses traffic from the session scope that cannot use the tunnel', () => {
    const ruleset = buildEgressFenceRuleset({ cgroupLevel: 2 });
    expect(ruleset).toContain('socket cgroupv2 level 2 @fenced jump fence');
    expect(ruleset).toContain('oif "lo" meta l4proto tcp accept');
    expect(ruleset).toContain('oif "lo" ip daddr 127.0.0.53 udp dport 53 accept');
    expect(ruleset).toContain('log prefix "eas-egress " level info');
    expect(ruleset).toContain('meta l4proto tcp counter name fence_tcp reject with tcp reset');
    expect(ruleset).toContain(
      'meta l4proto udp counter name fence_udp reject with icmpx admin-prohibited'
    );
    expect(ruleset).not.toMatch(/fence_\w+ accept/);
  });
});

describe(parseFenceLogLine, () => {
  it('parses a refused IPv4 TCP connection from the emulator', () => {
    expect(
      parseFenceLogLine(
        'eas-egress IN= OUT=ens3 SRC=10.128.0.5 DST=172.253.155.190 LEN=60 TOS=0x00 PREC=0x00 TTL=64 ID=1 DF PROTO=TCP SPT=42408 DPT=443 WINDOW=64240 RES=0x00 SYN URGP=0'
      )
    ).toEqual({
      process: 'Android emulator',
      pid: null,
      function: 'tcp',
      action: 'blocked',
      peer: '172.253.155.190:443',
      callers: [],
      note: expect.stringContaining('the emulator itself opened'),
    });
  });

  it('labels QUIC and compresses IPv6 destinations', () => {
    expect(
      parseFenceLogLine(
        'eas-egress IN= OUT=ens3 SRC=10.128.0.5 DST=142.250.152.94 LEN=1278 PROTO=UDP SPT=51000 DPT=443 LEN=1258'
      )
    ).toMatchObject({
      function: 'udp',
      peer: '142.250.152.94:443',
      note: expect.stringContaining('QUIC'),
    });
    expect(
      parseFenceLogLine(
        'eas-egress IN= OUT=ens3 SRC=fe80:0000:0000:0000:0000:0000:0000:0001 DST=ff02:0000:0000:0000:0000:0000:0000:00fb LEN=100 TC=0 HOPLIMIT=255 FLOWLBL=0 PROTO=UDP SPT=5353 DPT=5353 LEN=60'
      )
    ).toMatchObject({ function: 'udp', peer: '[ff02::fb]:5353', note: undefined });
  });

  it('reports ICMP without a port', () => {
    expect(
      parseFenceLogLine(
        'eas-egress IN= OUT=ens3 SRC=10.128.0.5 DST=8.8.8.8 LEN=84 PROTO=ICMP TYPE=8 CODE=0 ID=7 SEQ=1'
      )
    ).toMatchObject({ function: 'icmp', action: 'blocked', peer: '8.8.8.8' });
  });

  it('ignores unrelated kernel log lines', () => {
    expect(parseFenceLogLine('kvm: some unrelated message')).toBeNull();
    expect(parseFenceLogLine('eas-egress IN= OUT=ens3')).toBeNull();
  });
});

describe(parseFenceCounters, () => {
  it('reads packet counts from nft JSON output', () => {
    expect(
      parseFenceCounters(
        JSON.stringify({
          nftables: [
            { metainfo: { version: '1.1.6' } },
            { counter: { family: 'inet', name: 'fence_tcp', table: 'eas_fence', packets: 4 } },
            { counter: { family: 'inet', name: 'fence_udp', table: 'eas_fence', packets: 57 } },
            { counter: { family: 'inet', name: 'fence_other', table: 'eas_fence', packets: 2 } },
          ],
        })
      )
    ).toEqual({ tcp: 4, udp: 57, other: 2 });
  });
});

describe('process coverage', () => {
  let procRoot: string;

  beforeEach(async () => {
    procRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'fake-proc-'));
  });

  afterEach(async () => {
    await fs.promises.rm(procRoot, { recursive: true, force: true });
  });

  async function addProcessAsync(pid: number, comm: string, cgroup: string): Promise<void> {
    await fs.promises.mkdir(path.join(procRoot, String(pid)));
    await fs.promises.writeFile(path.join(procRoot, String(pid), 'comm'), `${comm}\n`);
    await fs.promises.writeFile(path.join(procRoot, String(pid), 'cgroup'), `0::${cgroup}\n`);
  }

  it('lists emulator processes and finds those outside the session scope', async () => {
    const scope = 'system.slice/eas-egress-session.scope';
    await addProcessAsync(10, 'qemu-system-x86', `/${scope}`);
    await addProcessAsync(11, 'netsimd', `/${scope}`);
    await addProcessAsync(12, 'netsimd', '/system.slice/eas-build-worker.service');
    await addProcessAsync(13, 'node', '/system.slice/eas-build-worker.service');
    await fs.promises.mkdir(path.join(procRoot, 'self'));

    const processes = await listEmulatorProcessesAsync(procRoot);
    expect(processes.map(({ pid }) => pid).sort()).toEqual([10, 11, 12]);
    expect(findProcessesOutsideScope(processes, scope)).toEqual([
      { pid: 12, comm: 'netsimd', cgroup: '/system.slice/eas-build-worker.service' },
    ]);
    expect(getCgroupLevel(scope)).toBe(2);
  });
});

describe('adb reverse parsing', () => {
  it('finds loopback ports a process listens on', () => {
    const ss = [
      'LISTEN 0 4096 127.0.0.1:8899 0.0.0.0:* users:(("chisel",pid=4321,fd=9))',
      'LISTEN 0 4096 127.0.0.1:8082 0.0.0.0:* users:(("chisel",pid=4321,fd=10))',
      'LISTEN 0 4096 127.0.0.1:5037 0.0.0.0:* users:(("adb",pid=999,fd=3))',
      'LISTEN 0 4096 127.0.0.1:52001 0.0.0.0:* users:(("chisel",pid=43210,fd=3))',
    ].join('\n');
    expect(parseLoopbackListenerPorts(ss, 4321)).toEqual([8082, 8899]);
  });

  it('parses adb reverse --list output', () => {
    expect(
      parseAdbReversePorts('emulator-5554 tcp:8082 tcp:8082\nemulator-5554 tcp:8083 tcp:8083\n')
    ).toEqual(new Set([8082, 8083]));
  });
});

describe(startLocalEgressRelayAsync, () => {
  async function getFreePortAsync(): Promise<number> {
    const server = net.createServer();
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as net.AddressInfo;
    await new Promise<void>(resolve => server.close(() => resolve()));
    return port;
  }

  async function exchangeAsync(port: number, request: string): Promise<string> {
    return await new Promise((resolve, reject) => {
      const socket = net.connect({ host: '127.0.0.1', port });
      let received = '';
      socket.on('data', chunk => {
        received += chunk.toString();
      });
      socket.on('error', reject);
      socket.on('close', () => resolve(received));
      socket.write(request);
    });
  }

  async function startUpstreamAsync(
    port: number
  ): Promise<{ requests: string[]; close: () => Promise<void> }> {
    const requests: string[] = [];
    const server = net.createServer(socket => {
      socket.once('data', chunk => {
        requests.push(chunk.toString());
        socket.end('upstream reply');
      });
    });
    await new Promise<void>(resolve => server.listen(port, '127.0.0.1', resolve));
    return {
      requests,
      close: async () => await new Promise<void>(resolve => server.close(() => resolve())),
    };
  }

  it('answers the readiness CONNECT itself, even without an egress client', async () => {
    const logger = createMockLogger();
    const relay = await startLocalEgressRelayAsync({
      port: await getFreePortAsync(),
      upstreamPort: await getFreePortAsync(),
      logger,
    });
    try {
      await expect(
        exchangeAsync(relay.port, 'CONNECT 192.0.2.1:443 HTTP/1.1\r\nHost: 192.0.2.1:443\r\n\r\n')
      ).resolves.toBe('HTTP/1.1 200 Connection Established\r\n\r\n');
      expect(logger.warn).not.toHaveBeenCalled();
    } finally {
      await relay.stopAsync();
    }
  });

  it('refuses while the client is detached and forwards once it attaches', async () => {
    const logger = createMockLogger();
    const upstreamPort = await getFreePortAsync();
    const relay = await startLocalEgressRelayAsync({
      port: await getFreePortAsync(),
      upstreamPort,
      logger,
    });
    const request = 'CONNECT 93.184.216.34:443 HTTP/1.1\r\nHost: 93.184.216.34:443\r\n\r\n';
    try {
      await expect(exchangeAsync(relay.port, request)).resolves.toMatch(
        /^HTTP\/1\.1 503 Service Unavailable\r\n[\s\S]*not connected/
      );
      await exchangeAsync(relay.port, request);
      expect(logger.warn).toHaveBeenCalledTimes(1);

      const upstream = await startUpstreamAsync(upstreamPort);
      try {
        await expect(exchangeAsync(relay.port, request)).resolves.toBe('upstream reply');
        expect(upstream.requests).toEqual([request]);
        expect(logger.info).toHaveBeenCalledWith(
          expect.stringContaining('2 request(s) from the Android emulator were refused')
        );
      } finally {
        await upstream.close();
      }
    } finally {
      await relay.stopAsync();
    }
  });

  it('unwraps a CONNECT to itself and forwards the inner request', async () => {
    const upstreamPort = await getFreePortAsync();
    const relay = await startLocalEgressRelayAsync({
      port: await getFreePortAsync(),
      upstreamPort,
      logger: createMockLogger(),
    });
    const upstream = await startUpstreamAsync(upstreamPort);
    const inner = 'CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n';
    try {
      await expect(
        exchangeAsync(
          relay.port,
          `CONNECT 10.0.2.2:${relay.port} HTTP/1.1\r\nHost: 10.0.2.2:${relay.port}\r\n\r\n${inner}`
        )
      ).resolves.toBe('HTTP/1.1 200 Connection Established\r\n\r\nupstream reply');
      expect(upstream.requests).toEqual([inner]);
    } finally {
      await upstream.close();
      await relay.stopAsync();
    }
  });
});

describe(resolveAndroidEmulatorLocalEgressAsync, () => {
  let handoffPath: string;

  beforeEach(async () => {
    handoffPath = path.join(
      await fs.promises.mkdtemp(path.join(os.tmpdir(), 'android-egress-handoff-')),
      'handoff.json'
    );
  });

  afterEach(async () => {
    await fs.promises.rm(path.dirname(handoffPath), { recursive: true, force: true });
  });

  it('returns null without a local egress session', async () => {
    await expect(resolveAndroidEmulatorLocalEgressAsync({ handoffPath })).resolves.toBeNull();
  });

  it('fails when a session exists but the fence was not started', async () => {
    await writeLocalEgressHandoffAsync(
      {
        url: 'https://egress.example.com',
        token: 'token',
        fingerprint: 'key=',
        port: 8899,
        platform: 'android',
      },
      handoffPath
    );
    await expect(resolveAndroidEmulatorLocalEgressAsync({ handoffPath })).rejects.toThrow(
      'the Android emulator fence was not started'
    );
  });
});
