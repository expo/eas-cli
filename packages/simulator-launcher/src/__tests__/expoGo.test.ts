import fs from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import os from 'node:os';
import path from 'node:path';

import { startExpoGoPreinstall } from '../utils/expoGo';
import { commands } from '../utils/processes';
import { deferred, until } from './helpers';

const runCommandAsync = commands.runAsync.bind(commands);
function createArchive(entries: { name: string; contents: Buffer }[]): Buffer {
  const blocks: Buffer[] = [];
  for (const { name, contents } of entries) {
    const header = Buffer.alloc(512);
    header.write(name);
    header.write('0000644\0', 100);
    header.write(contents.length.toString(8).padStart(11, '0') + '\0', 124);
    header.fill(32, 148, 156);
    header.write('0', 156);
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148);
    blocks.push(header, contents, Buffer.alloc((512 - (contents.length % 512)) % 512));
  }
  return gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]));
}
function installCalls() {
  return jest.mocked(commands.runAsync).mock.calls.filter(([file]) => file === 'xcrun');
}

let directory: string;
let archive: Buffer;
let controller: AbortController;
let warmup: ReturnType<typeof startExpoGoPreinstall> | undefined;
const stableUrl = 'https://example.test/Expo-Go-stable.tar.gz';
const sdkVersions = {
  '57.0.0': {
    releaseNoteUrl: 'https://example.test/57',
    iosClientUrl: 'https://example.test/old.tar.gz',
  },
  '58.0.0': { releaseNoteUrl: 'https://example.test/58', iosClientUrl: stableUrl },
  '59.0.0': {
    isBeta: true,
    releaseNoteUrl: 'https://example.test/beta',
    iosClientUrl: 'https://example.test/beta.tar.gz',
  },
  '60.0.0': { iosClientUrl: 'https://example.test/canary.tar.gz' },
  '61.1.0': {
    releaseNoteUrl: 'https://example.test/not-published',
    iosClientUrl: 'https://example.test/not-published.tar.gz',
  },
};

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'expo-go-unit-'));
  archive = createArchive([
    { name: 'Info.plist', contents: Buffer.from('<plist>fixture</plist>') },
  ]);
  jest.spyOn(os, 'tmpdir').mockReturnValue(directory);
  jest
    .spyOn(global, 'fetch')
    .mockImplementation(async url =>
      url === 'https://api.expo.dev/v2/versions'
        ? Response.json({ iosUrl: 'https://example.test/legacy.tar.gz', sdkVersions })
        : new Response(Uint8Array.from(archive))
    );
  jest
    .spyOn(commands, 'runAsync')
    .mockImplementation(async (file, args, signal) =>
      file === '/usr/bin/tar' ? await runCommandAsync(file, args, signal) : ''
    );
  jest.spyOn(commands, 'throwIfCommandCloseTimedOut').mockImplementation(() => {});
  jest.spyOn(process.stderr, 'write').mockReturnValue(true);
  controller = new AbortController();
  warmup = undefined;
});
afterEach(async () => {
  controller.abort();
  await warmup?.stopAsync().catch(() => {});
  jest.restoreAllMocks();
  await fs.rm(directory, { recursive: true, force: true });
});

it('uses the website stable release policy, extracts flat contents as .app and installs only after boot', async () => {
  const boot = deferred();
  warmup = startExpoGoPreinstall('UDID', boot.promise, controller.signal);
  try {
    await until(() => jest.mocked(fetch).mock.calls.length === 2);
    expect(fetch).toHaveBeenLastCalledWith(
      stableUrl,
      expect.objectContaining({
        headers: {
          Accept: 'application/json',
          'User-Agent': 'expo-simulator-launcher',
        },
      })
    );
    expect(installCalls()).toHaveLength(0);
    boot.resolve();
    await warmup.resultPromise;
    expect(installCalls()).toHaveLength(1);
    const [file, args, signal] = installCalls()[0];
    expect(file).toBe('xcrun');
    expect(args.slice(0, 3)).toEqual(['simctl', 'install', 'UDID']);
    expect(path.basename(args[3])).toBe('ExpoGo.app');
    expect(signal).toBeUndefined(); // Never cancel an in-flight installd transaction through simctl.
    await expect(fs.stat(path.dirname(args[3]))).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    boot.resolve();
  }
});

it('claim aborts a pending download without waiting for it, and a late fetch cannot install', async () => {
  const pending = deferred<Response>();
  jest.mocked(fetch).mockReturnValueOnce(pending.promise);
  warmup = startExpoGoPreinstall('UDID', Promise.resolve(), controller.signal);
  try {
    await until(() => jest.mocked(fetch).mock.calls.length > 0);
    await warmup.claimAsync();
    expect(jest.mocked(fetch).mock.calls[0][1]?.signal?.aborted).toBe(true);
    pending.resolve(Response.json({ sdkVersions })); // Even an uncooperative late fetch cannot install.
    await warmup.stopAsync();
    expect(installCalls()).toHaveLength(0);
    expect(
      (await fs.readdir(directory)).filter(name => name.startsWith('simulator-expo-go-'))
    ).toEqual([]);
  } finally {
    pending.resolve(Response.json({ sdkVersions }));
  }
});

it('claim only waits for the native install; terminal stop also drains temporary-file cleanup', async () => {
  const installation = deferred<string>();
  const cleanup = deferred();
  const remove = fs.rm.bind(fs);
  let cleanupStarted = false;
  jest.spyOn(fs, 'rm').mockImplementation(async (file, options) => {
    cleanupStarted = true;
    await cleanup.promise;
    return await remove(file, options);
  });
  jest
    .mocked(commands.runAsync)
    .mockImplementation(async (file, args) =>
      file === '/usr/bin/tar' ? await runCommandAsync(file, args) : await installation.promise
    );
  warmup = startExpoGoPreinstall('UDID', Promise.resolve(), controller.signal);
  try {
    await until(() => installCalls().length > 0);
    let claimed = false;
    const claiming = warmup.claimAsync().then(() => {
      claimed = true;
    });
    await new Promise(resolve => setImmediate(resolve));
    expect(claimed).toBe(false);
    installation.resolve('');
    await claiming;
    expect(claimed).toBe(true);
    await until(() => cleanupStarted);
    let stopped = false;
    const stopping = warmup.stopAsync().then(() => {
      stopped = true;
    });
    await new Promise(resolve => setImmediate(resolve));
    expect(stopped).toBe(false);
    cleanup.resolve();
    await stopping;
  } finally {
    installation.resolve('');
    cleanup.resolve();
  }
});

it('claim during extraction returns without waiting but cannot begin an install afterward', async () => {
  const extraction = deferred();
  let extracting = false;
  jest.mocked(commands.runAsync).mockImplementation(async (file, args) => {
    expect(file).toBe('/usr/bin/tar');
    extracting = true;
    await extraction.promise;
    return await runCommandAsync(file, args);
  });
  warmup = startExpoGoPreinstall('UDID', Promise.resolve(), controller.signal);
  try {
    await until(() => extracting);
    await warmup.claimAsync();
    expect(installCalls()).toHaveLength(0);
    let stopped = false;
    const stopping = warmup.stopAsync().then(() => {
      stopped = true;
    });
    await new Promise(resolve => setImmediate(resolve));
    expect(stopped).toBe(false);
    extraction.resolve();
    await stopping;
    expect(installCalls()).toHaveLength(0);
  } finally {
    extraction.resolve();
  }
});

it.each(['metadata', 'archive', 'install'])(
  'warns on an ordinary %s failure without failing warmup',
  async phase => {
    if (phase === 'metadata') {
      jest.mocked(fetch).mockResolvedValueOnce(new Response('', { status: 403 }));
    }
    if (phase === 'archive') {
      jest
        .mocked(fetch)
        .mockResolvedValueOnce(Response.json({ sdkVersions }))
        .mockResolvedValueOnce(new Response('', { status: 503 }));
    }
    if (phase === 'install') {
      jest.mocked(commands.runAsync).mockImplementation(async (file, args) => {
        if (file === '/usr/bin/tar') {
          return await runCommandAsync(file, args);
        }
        throw Object.assign(new Error('install failed'), { code: 1 });
      });
    }
    warmup = startExpoGoPreinstall('UDID', Promise.resolve(), controller.signal);
    await warmup.resultPromise;
    await warmup.claimAsync();
    await warmup.stopAsync();
    expect(process.stderr.write).toHaveBeenCalledWith(
      expect.stringContaining('Could not preinstall Expo Go')
    );
  }
);

it.each(['signal', 'close timeout', 'temp removal'])(
  'fails closed on %s instead of treating it as optional installation failure',
  async kind => {
    const error = Object.assign(new Error(`uncertain ${kind}`), {
      code: kind === 'signal' ? null : 1,
    });
    if (kind === 'temp removal') {
      jest.spyOn(fs, 'rm').mockRejectedValueOnce(error);
    } else {
      jest.mocked(commands.runAsync).mockImplementation(async (file, args) => {
        if (file === '/usr/bin/tar') {
          return await runCommandAsync(file, args);
        }
        if (kind === 'close timeout') {
          jest.mocked(commands.throwIfCommandCloseTimedOut).mockImplementation(() => {
            throw error;
          });
        }
        throw error;
      });
    }
    warmup = startExpoGoPreinstall('UDID', Promise.resolve(), controller.signal);
    await expect(warmup.resultPromise).rejects.toBe(error);
    await expect(warmup.claimAsync()).rejects.toBe(error);
    await expect(warmup.stopAsync()).rejects.toBe(error);
  }
);

it.each(['valid', 'traversal', 'malformed'] as const)(
  'drains the real owned extractor for a %s archive before removing temp files or settling stop',
  async kind => {
    const contents = Buffer.alloc(4 * 1024 * 1024, 97);
    archive =
      kind === 'malformed'
        ? Buffer.from('not a gzip or tar archive')
        : createArchive([
            ...(kind === 'traversal'
              ? [{ name: '../escaped', contents: Buffer.from('unsafe') }]
              : []),
            { name: 'Info.plist', contents: Buffer.from('<plist>fixture</plist>') },
            { name: 'ordinary-file', contents },
          ]);
    const start = commands.start.bind(commands);
    let extractor: ReturnType<typeof commands.start> | undefined;
    let extractorClosed = false;
    const remove = fs.rm.bind(fs);
    const removing = jest.spyOn(fs, 'rm').mockImplementation(async (file, options) => {
      expect(extractorClosed).toBe(true);
      if (kind === 'traversal') {
        await expect(fs.access(path.join(String(file), 'escaped'))).rejects.toMatchObject({
          code: 'ENOENT',
        });
      }
      if (kind !== 'malformed') {
        expect(
          (await fs.readFile(path.join(String(file), 'ExpoGo.app', 'ordinary-file'))).equals(
            contents
          )
        ).toBe(true);
      }
      return await remove(file, options);
    });
    jest.spyOn(commands, 'start').mockImplementation((file, args, options) => {
      expect(file).toBe('/usr/bin/tar');
      expect(args).toEqual([
        '-xzf',
        expect.stringMatching(/\/expo-go.tar.gz$/),
        '-C',
        expect.stringMatching(/\/ExpoGo.app$/),
      ]);
      expect(options?.signal).toBeUndefined();
      extractor = start(file, args, options);
      extractor.child.once('close', () => {
        extractorClosed = true;
      });
      expect(extractor.child.kill('SIGSTOP')).toBe(true);
      return extractor;
    });
    warmup = startExpoGoPreinstall('UDID', Promise.resolve(), controller.signal);
    try {
      await until(() => extractor !== undefined);
      await warmup.claimAsync(); // Only forbids new install; extraction remains owned and pending.
      expect(extractorClosed).toBe(false);
      let stopped = false;
      const stopping = warmup.stopAsync().then(() => {
        stopped = true;
      });
      await new Promise(resolve => setImmediate(resolve));
      expect(stopped).toBe(false);
      expect(removing).not.toHaveBeenCalled();
      extractor!.child.kill('SIGCONT');
      await stopping;
      expect(extractorClosed).toBe(true);
      expect(removing).toHaveBeenCalledTimes(1);
      expect(installCalls()).toHaveLength(0);
      expect(await fs.readdir(directory)).toEqual([]);
      if (kind !== 'valid') {
        const extractionError = await extractor!.resultPromise.catch(error => error);
        expect(extractionError.code).toBeGreaterThan(0);
      }
    } finally {
      // Reap only this test's owned child, including an assertion failure while it is stopped.
      if (extractor?.child.exitCode == null && extractor?.child.signalCode == null) {
        extractor?.child.kill('SIGCONT');
        extractor?.child.kill('SIGKILL');
      }
      await extractor?.resultPromise.catch(() => {});
      removing.mockRestore();
    }
  }
);

it('keeps owned temp files and rejects terminal stop when extractor close is uncertain', async () => {
  const failure = new Error('extractor close not proved');
  const remove = jest.spyOn(fs, 'rm');
  jest.mocked(commands.runAsync).mockImplementationOnce(async file => {
    expect(file).toBe('/usr/bin/tar');
    jest.mocked(commands.throwIfCommandCloseTimedOut).mockImplementation(() => {
      throw failure;
    });
    throw failure;
  });
  warmup = startExpoGoPreinstall('UDID', Promise.resolve(), controller.signal);
  await expect(warmup.resultPromise).rejects.toBe(failure);
  await expect(warmup.stopAsync()).rejects.toBe(failure);
  await expect(warmup.claimAsync()).rejects.toBe(failure);
  expect(remove).not.toHaveBeenCalled();
  expect((await fs.readdir(directory)).some(name => name.startsWith('simulator-expo-go-'))).toBe(
    true
  );
  expect(installCalls()).toHaveLength(0);
});

it.each(['traversal', 'malformed'] as const)(
  'never installs after a real %s archive failure without a claim',
  async kind => {
    archive =
      kind === 'malformed'
        ? Buffer.from('not an archive')
        : createArchive([
            { name: '../escaped', contents: Buffer.from('unsafe') },
            { name: 'Info.plist', contents: Buffer.from('<plist>fixture</plist>') },
          ]);
    warmup = startExpoGoPreinstall('UDID', Promise.resolve(), controller.signal);
    await warmup.resultPromise;
    expect(installCalls()).toHaveLength(0);
    expect(process.stderr.write).toHaveBeenCalledWith(
      expect.stringContaining('Could not preinstall Expo Go')
    );
    expect(await fs.readdir(directory)).toEqual([]);
  }
);

it('claim returns the identity read from the Expo Go it installed', async () => {
  const plist: Record<string, string> = {
    CFBundleIdentifier: 'host.exp.Exponent',
    CFBundleShortVersionString: '58.0.7',
    CFBundleVersion: '58.0.7',
  };
  jest
    .mocked(commands.runAsync)
    .mockImplementation(async (file, args, signal) =>
      file === '/usr/bin/tar'
        ? await runCommandAsync(file, args, signal)
        : file === 'plutil'
          ? `${plist[args[1]]}\n`
          : ''
    );
  warmup = startExpoGoPreinstall('UDID', Promise.resolve(), controller.signal);
  await warmup.resultPromise;
  expect(await warmup.claimAsync()).toEqual({
    udid: 'UDID',
    bundleIdentifier: 'host.exp.Exponent',
    shortVersion: '58.0.7',
    version: '58.0.7',
  });
  const plistPath = jest
    .mocked(commands.runAsync)
    .mock.calls.find(([file]) => file === 'plutil')![1];
  expect(path.basename(path.dirname(plistPath[5]))).toBe('ExpoGo.app');
});

it('claim returns no identity when the preinstall fails', async () => {
  jest
    .mocked(commands.runAsync)
    .mockImplementation(async (file, args, signal) =>
      file === '/usr/bin/tar'
        ? await runCommandAsync(file, args, signal)
        : file === 'xcrun'
          ? Promise.reject(Object.assign(new Error('install failed'), { code: 1 }))
          : ''
    );
  warmup = startExpoGoPreinstall('UDID', Promise.resolve(), controller.signal);
  await warmup.resultPromise;
  expect(await warmup.claimAsync()).toBeUndefined();
  expect(jest.mocked(commands.runAsync).mock.calls.some(([file]) => file === 'plutil')).toBe(false);
});

it('downloads and extracts once for two devices, then removes the shared app after both installs', async () => {
  warmup = startExpoGoPreinstall(
    'FIRST',
    Promise.resolve(),
    controller.signal,
    /* reuseArchive */ true
  );
  await warmup.resultPromise;
  const app = installCalls()[0][1][3];
  expect((await fs.stat(app)).isDirectory()).toBe(true);
  await warmup.preinstallOnDeviceAsync('SECOND', Promise.resolve(), controller.signal);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(
    jest.mocked(commands.runAsync).mock.calls.filter(([file]) => file === '/usr/bin/tar')
  ).toHaveLength(1);
  expect(installCalls().map(([, args]) => args.slice(2))).toEqual([
    ['FIRST', app],
    ['SECOND', app],
  ]);
  await expect(fs.stat(app)).rejects.toMatchObject({ code: 'ENOENT' });
  expect((await warmup.claimAsync('SECOND'))?.udid).toBe('SECOND');
});
it('a claim prevents secondary preinstall from starting and releases the retained archive', async () => {
  warmup = startExpoGoPreinstall(
    'FIRST',
    Promise.resolve(),
    controller.signal,
    /* reuseArchive */ true
  );
  await warmup.resultPromise;
  await warmup.claimAsync();
  await warmup.preinstallOnDeviceAsync('SECOND', Promise.resolve(), controller.signal);
  await warmup.stopAsync();
  expect(installCalls()).toHaveLength(1);
  expect(await fs.readdir(directory)).toEqual([]);
});
it('claim and stop drain a secondary native install without cancelling its transaction', async () => {
  const install = deferred<string>();
  const original = jest.mocked(commands.runAsync).getMockImplementation()!;
  warmup = startExpoGoPreinstall(
    'FIRST',
    Promise.resolve(),
    controller.signal,
    /* reuseArchive */ true
  );
  await warmup.resultPromise;
  jest
    .mocked(commands.runAsync)
    .mockImplementation((file, args, signal) =>
      file === 'xcrun' && args.includes('SECOND') ? install.promise : original(file, args, signal)
    );
  const secondary = warmup.preinstallOnDeviceAsync('SECOND', Promise.resolve(), controller.signal);
  let claimed = false;
  try {
    await until(() => installCalls().length === 2);
    const claiming = warmup.claimAsync('SECOND').then(() => {
      claimed = true;
    });
    await new Promise(resolve => setImmediate(resolve));
    expect(claimed).toBe(false);
    expect(installCalls()[1][2]).toBeUndefined();
    install.resolve('');
    await claiming;
    await secondary;
    await warmup.stopAsync();
    expect(await fs.readdir(directory)).toEqual([]);
  } finally {
    install.resolve('');
    await secondary;
  }
});

it.each(['signal', 'close timeout'])(
  'isolates a secondary %s failure from the already-installed default',
  async kind => {
    warmup = startExpoGoPreinstall('FIRST', Promise.resolve(), controller.signal, true);
    await warmup.resultPromise;
    const failure = Object.assign(new Error('secondary install failed'), { code: null });
    const original = jest.mocked(commands.runAsync).getMockImplementation()!;
    jest.mocked(commands.runAsync).mockImplementation((file, args, signal) => {
      if (file === 'xcrun' && args.includes('SECOND')) {
        if (kind === 'close timeout') {
          jest.mocked(commands.throwIfCommandCloseTimedOut).mockImplementation(() => {
            throw failure;
          });
        }
        return Promise.reject(failure);
      }
      return original(file, args, signal);
    });
    await expect(
      warmup.preinstallOnDeviceAsync('SECOND', Promise.resolve(), controller.signal)
    ).rejects.toBe(failure);
    expect((await warmup.claimAsync('FIRST'))?.udid).toBe('FIRST');
    await expect(warmup.claimAsync('SECOND')).rejects.toBe(failure);
    if (kind === 'close timeout') {
      await expect(warmup.stopAsync('FIRST')).rejects.toBe(failure);
    } else {
      await expect(warmup.stopAsync('FIRST')).resolves.toBeUndefined();
    }
    await expect(warmup.stopAsync('SECOND')).rejects.toBe(failure);
  }
);
it('a concurrent stop cannot miss a secondary install failure while shared cleanup drains', async () => {
  warmup = startExpoGoPreinstall('FIRST', Promise.resolve(), controller.signal, true);
  await warmup.resultPromise;
  const installation = deferred<string>();
  const original = jest.mocked(commands.runAsync).getMockImplementation()!;
  jest
    .mocked(commands.runAsync)
    .mockImplementation((file, args, signal) =>
      file === 'xcrun' && args.includes('SECOND')
        ? installation.promise
        : original(file, args, signal)
    );
  const secondary = warmup.preinstallOnDeviceAsync('SECOND', Promise.resolve(), controller.signal);
  void secondary.catch(() => {});
  try {
    await until(() => installCalls().length === 2);
    const stopping = warmup.stopAsync('SECOND');
    void stopping.catch(() => {});
    const failure = Object.assign(new Error('secondary killed'), { code: null });
    installation.reject(failure);
    await expect(stopping).rejects.toBe(failure);
    await expect(secondary).rejects.toBe(failure);
  } finally {
    installation.resolve('');
    await secondary.catch(() => {});
  }
});

it('preinstalls all three configured devices from one shared archive through the session owner', async () => {
  const { createWarmSimulatorSession } = await import('../commands/start');
  const simulator = await import('../utils/simulator');
  const serveSim = await import('../utils/serveSim');
  const processes = await import('../utils/processes');
  const agentDevice = await import('../utils/agentDevice');
  const argent = await import('../utils/argent');
  const devices = ['FIRST', 'SECOND', 'THIRD'].map(udid => ({ udid, name: `iPhone ${udid}` }));
  const environment = { ...process.env };
  process.env.EXPO_SIMULATOR_DEVICE = devices.map(device => device.udid).join(',');
  process.env.AGENT_DEVICE_STATE_DIR = path.join(directory, 'agent');
  process.env.ARGENT_EVENT_LOG = path.join(directory, 'argent-events');
  jest.spyOn(simulator, 'listAvailableSimulatorsAsync').mockResolvedValue(devices);
  jest.spyOn(simulator, 'waitForSimulatorBootAsync').mockResolvedValue();
  jest.spyOn(simulator, 'disableApsdAsync').mockResolvedValue();
  jest.spyOn(simulator, 'shutdownSimulatorAsync').mockResolvedValue();
  jest.spyOn(processes, 'stopProcessAndDescendantsAsync').mockResolvedValue();
  jest.spyOn(agentDevice, 'createAgentDeviceTool').mockReturnValue({
    name: 'agent-device',
    startAsync: async () => {},
    stopAsync: async () => {},
  });
  jest
    .spyOn(argent, 'createArgentTool')
    .mockReturnValue({ name: 'argent', startAsync: async () => {}, stopAsync: async () => {} });
  jest.spyOn(serveSim, 'startServeSim').mockReturnValue({
    child: { pid: 90001 } as import('node:child_process').ChildProcess,
    resultPromise: new Promise(() => {}),
  });
  jest.spyOn(serveSim, 'waitForServeSimReadyAsync').mockResolvedValue({
    startupDevice: 'FIRST',
    pid: 90001,
    port: 3200,
    nativeStartTime: 'start-time',
    url: 'http://127.0.0.1:3200',
    token: 'fixture-token',
  });
  const original = jest.mocked(commands.runAsync).getMockImplementation()!;
  jest.mocked(commands.runAsync).mockImplementation(async (file, args, signal) => {
    if (file === 'ps') {
      return 'controller-start';
    }
    if (file === 'plutil') {
      return args.includes('CFBundleIdentifier') ? 'host.exp.Exponent' : '58.0.7';
    }
    return original(file, args, signal);
  });
  const onFailure = jest.fn();
  const session = createWarmSimulatorSession({
    signal: controller.signal,
    isReadyAsync: async () => true,
    throwIfStoppingAsync: async () => controller.signal.throwIfAborted(),
    onPreparationFailure: onFailure,
    onBackgroundFailure: onFailure,
  });
  try {
    await session.prepareAsync();
    session.startExtraWarmupInBackground();
    await until(() => installCalls().length === 3);
    const claim = await session.claimAsync({ engine: 'serve-sim', requestedDevice: 'THIRD' });
    expect(claim.preinstalledExpoGo).toEqual({
      udid: 'THIRD',
      bundleIdentifier: 'host.exp.Exponent',
      shortVersion: '58.0.7',
      version: '58.0.7',
    });
    expect(installCalls().map(([, args]) => args[2])).toEqual(['FIRST', 'SECOND', 'THIRD']);
    expect(new Set(installCalls().map(([, args]) => args[3])).size).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(
      jest.mocked(commands.runAsync).mock.calls.filter(([file]) => file === '/usr/bin/tar')
    ).toHaveLength(1);
    expect(onFailure).not.toHaveBeenCalled();
  } finally {
    await session.stopAsync();
    process.env = environment;
  }
});
