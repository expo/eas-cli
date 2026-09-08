import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  CHISEL_VERSION,
  LOCAL_EGRESS_PROXY_PORT,
  buildEgressPfRules,
  buildEgressRemoteConfigFields,
  buildNetworksetupProxyArgs,
  createChiselAuthfileContents,
  getChiselAssetName,
  getChiselDownloadUrl,
  parseChiselFingerprint,
  parseDefaultRouteInterface,
  parseDnsResolvers,
  parseExitIpResponse,
  parseNetworkServiceNameForDevice,
  readLocalEgressHandoffAsync,
  writeLocalEgressHandoffAsync,
} from '../localEgress';

jest.mock('@ngrok/ngrok');
jest.mock('@expo/turtle-spawn');

describe(getChiselAssetName, () => {
  it.each([
    ['darwin', 'arm64', `chisel_${CHISEL_VERSION}_darwin_arm64.gz`],
    ['darwin', 'x64', `chisel_${CHISEL_VERSION}_darwin_amd64.gz`],
    ['linux', 'x64', `chisel_${CHISEL_VERSION}_linux_amd64.gz`],
    ['linux', 'arm64', `chisel_${CHISEL_VERSION}_linux_arm64.gz`],
  ] as const)('maps %s/%s to %s', (platform, arch, expected) => {
    expect(getChiselAssetName({ platform, arch })).toBe(expected);
  });

  it('rejects platforms without a pinned binary', () => {
    expect(() => getChiselAssetName({ platform: 'win32', arch: 'x64' })).toThrow(
      'Local egress is not supported on win32/x64'
    );
    expect(() => getChiselAssetName({ platform: 'linux', arch: 'ia32' })).toThrow(
      'Local egress is not supported on linux/ia32'
    );
  });

  it('downloads from the pinned GitHub release', () => {
    expect(getChiselDownloadUrl(`chisel_${CHISEL_VERSION}_darwin_arm64.gz`)).toBe(
      `https://github.com/jpillora/chisel/releases/download/v${CHISEL_VERSION}/chisel_${CHISEL_VERSION}_darwin_arm64.gz`
    );
  });
});

describe(createChiselAuthfileContents, () => {
  it('allows exactly one reverse remote: the loopback proxy port', () => {
    const contents = createChiselAuthfileContents({ user: 'eas', password: 'pw', port: 8899 });
    const parsed = JSON.parse(contents) as Record<string, string[]>;
    expect(parsed).toEqual({ 'eas:pw': ['^R:127\\.0\\.0\\.1:8899$'] });

    const pattern = new RegExp(parsed['eas:pw'][0]);
    expect(pattern.test('R:127.0.0.1:8899')).toBe(true);
    expect(pattern.test('R:0.0.0.0:8899')).toBe(false);
    expect(pattern.test('R:127.0.0.1:88990')).toBe(false);
    expect(pattern.test('R:127x0x0x1:8899')).toBe(false);
    expect(pattern.test('R:socks')).toBe(false);
    expect(pattern.test('example.com:443')).toBe(false);
  });
});

describe(parseChiselFingerprint, () => {
  it('extracts the fingerprint chisel prints at startup', () => {
    const output =
      '2026/09/07 22:00:00 server: Fingerprint eZm5d2ZQ+Zb2aS0lJm7A5GkWm9G9ZqnPz2W0i2Y6Q1c=\n' +
      '2026/09/07 22:00:00 server: Reverse tunnelling enabled\n' +
      '2026/09/07 22:00:00 server: Listening on http://127.0.0.1:52001\n';
    expect(parseChiselFingerprint(output)).toBe('eZm5d2ZQ+Zb2aS0lJm7A5GkWm9G9ZqnPz2W0i2Y6Q1c=');
  });

  it('returns null before the fingerprint line appears', () => {
    expect(parseChiselFingerprint('')).toBeNull();
    expect(parseChiselFingerprint('2026/09/07 22:00:00 server: starting')).toBeNull();
  });
});

describe(parseDefaultRouteInterface, () => {
  it('reads the interface from `route -n get default`', () => {
    const output =
      '   route to: default\n' +
      'destination: default\n' +
      '       mask: default\n' +
      '    gateway: 172.20.10.1\n' +
      '  interface: en0\n' +
      '      flags: <UP,GATEWAY,DONE,STATIC,PRCLONING,GLOBAL>\n';
    expect(parseDefaultRouteInterface(output)).toBe('en0');
  });

  it('returns null when there is no default route', () => {
    expect(
      parseDefaultRouteInterface('route: writing to routing socket: not in table\n')
    ).toBeNull();
  });
});

describe(parseNetworkServiceNameForDevice, () => {
  const listOutput =
    'An asterisk (*) denotes that a network service is disabled.\n' +
    '(1) Thunderbolt Ethernet Slot 0\n' +
    '(Hardware Port: Thunderbolt Ethernet Slot 0, Device: en8)\n' +
    '\n' +
    '(2) Thunderbolt Bridge\n' +
    '(Hardware Port: Thunderbolt Bridge, Device: bridge0)\n' +
    '\n' +
    '(3) Wi-Fi\n' +
    '(Hardware Port: Wi-Fi, Device: en0)\n' +
    '\n' +
    '(4) iPhone USB\n' +
    '(Hardware Port: iPhone USB, Device: en9)\n';

  it('returns the service whose device matches', () => {
    expect(parseNetworkServiceNameForDevice(listOutput, 'en0')).toBe('Wi-Fi');
    expect(parseNetworkServiceNameForDevice(listOutput, 'en8')).toBe('Thunderbolt Ethernet Slot 0');
  });

  it('returns null for an unknown device', () => {
    expect(parseNetworkServiceNameForDevice(listOutput, 'utun3')).toBeNull();
  });
});

describe(buildNetworksetupProxyArgs, () => {
  it('sets both the HTTP and HTTPS proxy to the loopback egress port', () => {
    expect(
      buildNetworksetupProxyArgs({ service: 'Ethernet', host: '127.0.0.1', port: 8899 })
    ).toEqual([
      ['-setwebproxy', 'Ethernet', '127.0.0.1', '8899'],
      ['-setsecurewebproxy', 'Ethernet', '127.0.0.1', '8899'],
    ]);
  });
});

describe(parseDnsResolvers, () => {
  it('collects unique nameservers from `scutil --dns`', () => {
    const output =
      'DNS configuration\n' +
      '\n' +
      'resolver #1\n' +
      '  nameserver[0] : 192.168.64.1\n' +
      '  nameserver[1] : 8.8.8.8\n' +
      '  if_index : 4 (en0)\n' +
      '\n' +
      'resolver #2\n' +
      '  domain   : local\n' +
      '  options  : mdns\n' +
      '\n' +
      'DNS configuration (for scoped queries)\n' +
      '\n' +
      'resolver #1\n' +
      '  nameserver[0] : 192.168.64.1\n';
    expect(parseDnsResolvers(output)).toEqual(['192.168.64.1', '8.8.8.8']);
  });
});

describe(buildEgressPfRules, () => {
  const existingRules =
    'pass in quick proto tcp from 192.168.64.1 to any\n' +
    'pass in quick proto udp from 192.168.64.1 to any\n' +
    'pass out quick proto tcp from any to 192.168.64.1\n' +
    'pass out quick proto udp from any to 192.168.64.1\n' +
    'block drop in inet from 192.168.64.0/24 to any\n';

  it('keeps the existing anchor rules first and appends DNS passes before the UDP block', () => {
    expect(
      buildEgressPfRules({ existingRules, resolvers: ['192.168.64.1', '8.8.8.8'] }).split('\n')
    ).toEqual([
      'pass in quick proto tcp from 192.168.64.1 to any',
      'pass in quick proto udp from 192.168.64.1 to any',
      'pass out quick proto tcp from any to 192.168.64.1',
      'pass out quick proto udp from any to 192.168.64.1',
      'block drop in inet from 192.168.64.0/24 to any',
      'pass out quick proto udp from any to 192.168.64.1 port 53',
      'pass out quick proto udp from any to 8.8.8.8 port 53',
      'block drop out quick inet proto udp all',
      'block drop out quick inet6 proto udp all',
      '',
    ]);
  });

  it('is idempotent when applied to its own output', () => {
    const once = buildEgressPfRules({ existingRules, resolvers: ['192.168.64.1'] });
    const twice = buildEgressPfRules({ existingRules: once, resolvers: ['192.168.64.1'] });
    expect(twice).toBe(once);
  });

  it('blocks all UDP when no resolver is known', () => {
    expect(buildEgressPfRules({ existingRules: '', resolvers: [] })).toBe(
      'block drop out quick inet proto udp all\nblock drop out quick inet6 proto udp all\n'
    );
  });
});

describe(buildEgressRemoteConfigFields, () => {
  it('returns nothing without a handoff', () => {
    expect(buildEgressRemoteConfigFields(null)).toEqual({});
  });

  it('maps the handoff to the remoteConfig field names', () => {
    expect(
      buildEgressRemoteConfigFields({
        url: 'https://egress-abc.eas-simulator.ngrok.dev',
        auth: 'eas:pw',
        fingerprint: 'fp=',
        port: LOCAL_EGRESS_PROXY_PORT,
      })
    ).toEqual({
      egressUrl: 'https://egress-abc.eas-simulator.ngrok.dev',
      egressAuth: 'eas:pw',
      egressFingerprint: 'fp=',
      egressPort: LOCAL_EGRESS_PROXY_PORT,
    });
  });
});

describe(parseExitIpResponse, () => {
  it('reads the ip field', () => {
    expect(parseExitIpResponse('{"ip":"64.114.211.44"}')).toBe('64.114.211.44');
  });

  it('rejects responses without an ip', () => {
    expect(() => parseExitIpResponse('{"error":"rate limited"}')).toThrow(
      'Unexpected exit IP response'
    );
  });
});

describe('local egress handoff', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'local-egress-test-'));
  });

  afterEach(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  });

  it('round-trips through the handoff file', async () => {
    const handoffPath = path.join(tempDir, 'handoff.json');
    const handoff = {
      url: 'https://egress-abc.eas-simulator.ngrok.dev',
      auth: 'eas:pw',
      fingerprint: 'fp=',
      port: 8899,
    };
    await writeLocalEgressHandoffAsync(handoff, handoffPath);
    await expect(readLocalEgressHandoffAsync(handoffPath)).resolves.toEqual(handoff);
  });

  it('returns null when no egress step ran', async () => {
    await expect(
      readLocalEgressHandoffAsync(path.join(tempDir, 'missing.json'))
    ).resolves.toBeNull();
  });

  it('rejects a malformed handoff', async () => {
    const handoffPath = path.join(tempDir, 'handoff.json');
    await fs.promises.writeFile(handoffPath, JSON.stringify({ url: 'x' }), 'utf8');
    await expect(readLocalEgressHandoffAsync(handoffPath)).rejects.toThrow('malformed');
  });
});
