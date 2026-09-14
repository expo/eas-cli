import { type bunyan } from '@expo/logger';
import spawn from '@expo/turtle-spawn';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { spawnDetached } from '../remoteDeviceRunSession';

import {
  CHISEL_VERSION,
  LOCAL_EGRESS_NO_PROXY,
  LOCAL_EGRESS_PROXY_PORT,
  buildEgressRemoteConfigFields,
  buildLocalEgressSimulatorEnvironment,
  buildNetworksetupProxyArgs,
  collectSimulatorProcessIds,
  configureSimulatorProxyEnvironmentAsync,
  createChiselAuthfileContents,
  getChiselAssetName,
  getChiselDownloadUrl,
  parseChiselFingerprint,
  parseDefaultRouteInterface,
  parseDirectSimulatorConnections,
  parseExitIpResponse,
  parseNetworkServiceNameForDevice,
  readLocalEgressHandoffAsync,
  registerLocalEgressResources,
  startChiselServerAsync,
  stopLocalEgressResourcesAsync,
  writeLocalEgressHandoffAsync,
} from '../localEgress';

jest.mock('@ngrok/ngrok');
jest.mock('@expo/turtle-spawn');
jest.mock('../remoteDeviceRunSession', () => ({ spawnDetached: jest.fn() }));

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
  it('allows reverse remotes on the loopback proxy port and unprivileged loopback ports only', () => {
    const contents = createChiselAuthfileContents({ user: 'eas', password: 'pw', port: 8899 });
    const parsed = JSON.parse(contents) as Record<string, string[]>;
    expect(parsed['eas:pw']).toHaveLength(2);
    expect(parsed['eas:pw'][0]).toBe('^R:127\\.0\\.0\\.1:8899$');

    const patterns = parsed['eas:pw'].map(source => new RegExp(source));
    const allowed = (remote: string): boolean => patterns.some(pattern => pattern.test(remote));
    expect(allowed('R:127.0.0.1:8899')).toBe(true);
    expect(allowed('R:127.0.0.1:1024')).toBe(true);
    expect(allowed('R:127.0.0.1:3000')).toBe(true);
    expect(allowed('R:127.0.0.1:8081')).toBe(true);
    expect(allowed('R:127.0.0.1:65535')).toBe(true);
    // Privileged and out-of-range ports, other interfaces, and forward remotes stay denied.
    expect(allowed('R:127.0.0.1:1023')).toBe(false);
    expect(allowed('R:127.0.0.1:80')).toBe(false);
    expect(allowed('R:127.0.0.1:0')).toBe(false);
    expect(allowed('R:127.0.0.1:65536')).toBe(false);
    expect(allowed('R:127.0.0.1:88990')).toBe(false);
    expect(allowed('R:0.0.0.0:8899')).toBe(false);
    expect(allowed('R:0.0.0.0:3000')).toBe(false);
    expect(allowed('R:[::1]:3000')).toBe(false);
    expect(allowed('R:127x0x0x1:8899')).toBe(false);
    expect(allowed('R:socks')).toBe(false);
    expect(allowed('example.com:443')).toBe(false);
    expect(allowed('127.0.0.1:3000')).toBe(false);
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

describe(buildLocalEgressSimulatorEnvironment, () => {
  it('points every proxy variable at the loopback port and excludes loopback', () => {
    expect(buildLocalEgressSimulatorEnvironment(8899)).toEqual({
      http_proxy: 'http://127.0.0.1:8899',
      https_proxy: 'http://127.0.0.1:8899',
      HTTP_PROXY: 'http://127.0.0.1:8899',
      HTTPS_PROXY: 'http://127.0.0.1:8899',
      grpc_proxy: 'http://127.0.0.1:8899',
      no_proxy: LOCAL_EGRESS_NO_PROXY,
      NO_PROXY: LOCAL_EGRESS_NO_PROXY,
    });
  });
});

describe(configureSimulatorProxyEnvironmentAsync, () => {
  const mockedSpawn = jest.mocked(spawn);
  let tempDir: string;
  let logger: bunyan;

  beforeEach(async () => {
    mockedSpawn.mockReset();
    mockedSpawn.mockResolvedValue({ stdout: '', stderr: '' } as any);
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'local-egress-env-test-'));
    logger = { info: jest.fn(), warn: jest.fn() } as unknown as bunyan;
  });

  afterEach(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  });

  it('does nothing when no local egress session is active', async () => {
    await expect(
      configureSimulatorProxyEnvironmentAsync({
        udid: 'test-udid' as any,
        env: process.env,
        logger,
        handoffPath: path.join(tempDir, 'missing.json'),
      })
    ).resolves.toBe(false);

    expect(mockedSpawn).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('sets the proxy environment in the simulator when a handoff exists', async () => {
    const handoffPath = path.join(tempDir, 'handoff.json');
    await writeLocalEgressHandoffAsync(
      { url: 'https://egress.example', token: 'pw', fingerprint: 'fp=', port: 8899 },
      handoffPath
    );

    await expect(
      configureSimulatorProxyEnvironmentAsync({
        udid: 'test-udid' as any,
        env: process.env,
        logger,
        handoffPath,
      })
    ).resolves.toBe(true);

    expect(mockedSpawn.mock.calls.map(([, args]) => args)).toEqual([
      [
        'simctl',
        'spawn',
        'test-udid',
        'launchctl',
        'setenv',
        ...Object.entries(buildLocalEgressSimulatorEnvironment(8899)).flat(),
      ],
    ]);
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('proxy environment variables set')
    );
  });

  it('warns and continues when launchctl fails', async () => {
    const handoffPath = path.join(tempDir, 'handoff.json');
    await writeLocalEgressHandoffAsync(
      { url: 'https://egress.example', token: 'pw', fingerprint: 'fp=', port: 8899 },
      handoffPath
    );
    mockedSpawn.mockRejectedValue(new Error('launchctl failed'));

    await expect(
      configureSimulatorProxyEnvironmentAsync({
        udid: 'test-udid' as any,
        env: process.env,
        logger,
        handoffPath,
      })
    ).resolves.toBe(false);

    expect(logger.warn).toHaveBeenCalledWith(
      { err: expect.any(Error) },
      expect.stringContaining('will bypass local egress and exit from this worker')
    );
  });

  it('warns and continues when the handoff is malformed', async () => {
    const handoffPath = path.join(tempDir, 'handoff.json');
    await fs.promises.writeFile(handoffPath, JSON.stringify({ url: 'x' }), 'utf8');

    await expect(
      configureSimulatorProxyEnvironmentAsync({
        udid: 'test-udid' as any,
        env: process.env,
        logger,
        handoffPath,
      })
    ).resolves.toBe(false);

    expect(mockedSpawn).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      { err: expect.any(Error) },
      expect.stringContaining('could not read the local egress handoff')
    );
  });
});

describe(startChiselServerAsync, () => {
  const options = {
    chiselPath: '/tmp/chisel',
    controlPort: 52001,
    authfilePath: '/tmp/authfile.json',
    env: { PATH: '/bin', AUTH: 'unexpected:password' },
  };
  let output: string;
  let stopAsync: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers();
    output = 'server: Fingerprint pinned-key=\n';
    stopAsync = jest.fn().mockResolvedValue(undefined);
    jest.spyOn(process, 'kill').mockReturnValue(true);
    jest.mocked(spawnDetached).mockReturnValue({
      pid: 12345,
      getOutput: () => output,
      stopAsync,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('waits for the child to bind its exact port and clears inherited AUTH', async () => {
    let resolved = false;
    const started = startChiselServerAsync(options).then(result => {
      resolved = true;
      return result;
    });
    output += 'server: Listening on http://127.0.0.1:520010\n';
    await jest.advanceTimersByTimeAsync(250);
    expect(resolved).toBe(false);
    output += 'server: Listening on http://127.0.0.1:52001\n';
    await jest.advanceTimersByTimeAsync(250);
    await expect(started).resolves.toMatchObject({ fingerprint: 'pinned-key=' });
    expect(spawnDetached).toHaveBeenCalledWith(
      expect.objectContaining({ env: { PATH: '/bin', AUTH: '' } })
    );
    expect(options.env.AUTH).toBe('unexpected:password');
    expect(stopAsync).not.toHaveBeenCalled();
  });

  it('rejects and stops a child that prints its fingerprint then fails to bind', async () => {
    const started = startChiselServerAsync(options);
    const rejected = expect(started).rejects.toThrow('address already in use');
    output += 'listen tcp 127.0.0.1:52001: bind: address already in use\n';
    jest.mocked(process.kill).mockImplementation(() => {
      throw new Error('ESRCH');
    });
    await jest.advanceTimersByTimeAsync(250);
    await rejected;
    expect(stopAsync).toHaveBeenCalledTimes(1);
  });

  it('stops the child when startup is cancelled', async () => {
    const controller = new AbortController();
    const started = startChiselServerAsync({ ...options, signal: controller.signal });
    const rejected = expect(started).rejects.toThrow('cancelled');
    controller.abort(new Error('cancelled'));
    await jest.advanceTimersByTimeAsync(250);
    await rejected;
    expect(stopAsync).toHaveBeenCalledTimes(1);
  });
});

describe('local egress resource lifetime', () => {
  const logger = { warn: jest.fn() } as unknown as bunyan;

  it('aborts the lifetime and awaits the same cleanup for concurrent callers', async () => {
    let finish!: () => void;
    const cleanup = jest.fn(
      () =>
        new Promise<void>(resolve => {
          finish = resolve;
        })
    );
    const signal = registerLocalEgressResources(cleanup);
    const first = stopLocalEgressResourcesAsync(logger);
    const second = stopLocalEgressResourcesAsync(logger);
    expect(signal.aborted).toBe(true);
    await Promise.resolve();
    expect(cleanup).toHaveBeenCalledTimes(1);
    let complete = false;
    void second.then(() => {
      complete = true;
    });
    await Promise.resolve();
    expect(complete).toBe(false);
    finish();
    await Promise.all([first, second]);
    await stopLocalEgressResourcesAsync(logger);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('reports cleanup failure without masking the job result', async () => {
    const error = new Error('cleanup failed');
    registerLocalEgressResources(async () => {
      throw error;
    });
    await expect(stopLocalEgressResourcesAsync(logger)).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      { err: error },
      'Could not stop a local egress resource.'
    );
  });
});
