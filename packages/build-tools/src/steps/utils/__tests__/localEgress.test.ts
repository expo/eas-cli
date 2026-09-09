import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  CHISEL_VERSION,
  LOCAL_EGRESS_PROXY_PORT,
  buildEgressRemoteConfigFields,
  buildNetworksetupProxyArgs,
  collectSimulatorProcessIds,
  createChiselAuthfileContents,
  getChiselAssetName,
  getChiselDownloadUrl,
  parseChiselFingerprint,
  parseDefaultRouteInterface,
  parseDirectSimulatorConnections,
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

describe(collectSimulatorProcessIds, () => {
  const runtimeRoot =
    '/Library/Developer/CoreSimulator/Volumes/iOS_23F77/Library/Developer/CoreSimulator/Profiles/Runtimes/iOS 26.5.simruntime/Contents/Resources/RuntimeRoot';
  const psOutput =
    '    1     0 /sbin/launchd\n' +
    '  501     1 /usr/local/bin/node\n' +
    `  600     1 ${runtimeRoot}/sbin/launchd_sim\n` +
    '  610   600 /Users/expo/Library/Developer/CoreSimulator/Devices/ABC/data/Containers/Bundle/Application/DEF/App.app/App\n' +
    `  611   600 ${runtimeRoot}/System/Library/ExtensionKit/Extensions/NetworkingExtension.appex/com.apple.WebKit.Networking\n` +
    '  620   610 /usr/bin/helper\n' +
    '  700     1 /usr/sbin/lsof\n';

  it('returns every descendant of launchd_sim and nothing else', () => {
    expect(collectSimulatorProcessIds(psOutput).sort((a, b) => a - b)).toEqual([610, 611, 620]);
  });

  it('returns nothing when no simulator is running', () => {
    expect(
      collectSimulatorProcessIds('    1     0 /sbin/launchd\n  501     1 /usr/local/bin/node\n')
    ).toEqual([]);
  });
});

describe(parseDirectSimulatorConnections, () => {
  const lsofOutput = [
    'p610',
    'cApp',
    'f10',
    'PTCP',
    'n127.0.0.1:52344->127.0.0.1:8899',
    'TST=ESTABLISHED',
    'f11',
    'PTCP',
    'n192.168.64.2:52345->93.184.216.34:443',
    'TST=ESTABLISHED',
    'f12',
    'PTCP',
    'n192.168.64.2:52346->104.16.0.1:443',
    'TST=SYN_SENT',
    'f13',
    'PTCP',
    'n*:8080',
    'TST=LISTEN',
    'f14',
    'PUDP',
    'n*:5353',
    'f15',
    'PUDP',
    'n192.168.64.2:60000->1.1.1.1:443',
    'f16',
    'PTCP',
    'n[::1]:52347->[::1]:8899',
    'TST=ESTABLISHED',
    'f17',
    'PTCP',
    'n[fd00::2]:52348->[2606:4700:4700::1111]:443',
    'TST=ESTABLISHED',
    'p700',
    'cnode',
    'f20',
    'PTCP',
    'n192.168.64.2:52349->93.184.216.34:443',
    'TST=ESTABLISHED',
    '',
  ].join('\n');

  it('reports simulator connections to non-loopback peers only', () => {
    expect(parseDirectSimulatorConnections(lsofOutput, new Set([610]))).toEqual([
      { pid: 610, command: 'App', protocol: 'TCP', remote: '93.184.216.34:443' },
      { pid: 610, command: 'App', protocol: 'TCP', remote: '104.16.0.1:443' },
      { pid: 610, command: 'App', protocol: 'UDP', remote: '1.1.1.1:443' },
      { pid: 610, command: 'App', protocol: 'TCP', remote: '[2606:4700:4700::1111]:443' },
    ]);
  });

  it('ignores processes outside the simulator', () => {
    expect(parseDirectSimulatorConnections(lsofOutput, new Set([700]))).toEqual([
      { pid: 700, command: 'node', protocol: 'TCP', remote: '93.184.216.34:443' },
    ]);
    expect(parseDirectSimulatorConnections(lsofOutput, new Set([999]))).toEqual([]);
  });

  it('returns nothing for an empty listing', () => {
    expect(parseDirectSimulatorConnections('', new Set([610]))).toEqual([]);
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
        token: 'pw',
        fingerprint: 'fp=',
        port: LOCAL_EGRESS_PROXY_PORT,
      })
    ).toEqual({
      egressUrl: 'https://egress-abc.eas-simulator.ngrok.dev',
      egressToken: 'pw',
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
      token: 'pw',
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
