import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { claimAsync } from '../commands/claim';
import { stopAsync } from '../commands/stop';
import {
  LAUNCHER_STATE_FILE,
  readLauncherStateAsync,
  updateLauncherStateAsync,
  waitForLauncherStateAsync,
} from '../utils/state';
import { deferred } from './helpers';

const boot = 'boot-one';
let root: string;
const info = {
  device: { udid: 'PHONE', name: 'iPhone 17', port: 3200 },
  controllerPid: 9000,
  controllerStartTime: 'Thu Oct 22 10:00:00 2026',
  agentDeviceStateDir: '/agent',
  argentEventLogPath: '/argent/events',
};
const directory = () => path.join(root, 'control');

const nativeFs = {
  readFile: fs.readFile.bind(fs),
  writeFile: fs.writeFile.bind(fs),
  rename: fs.rename.bind(fs),
  rm: fs.rm.bind(fs),
  mkdir: fs.mkdir.bind(fs),
  rmdir: fs.rmdir.bind(fs),
  stat: fs.stat.bind(fs),
};
const remap = (file: unknown): unknown =>
  typeof file === 'string' && file.startsWith(LAUNCHER_STATE_FILE)
    ? path.join(root, 'control', path.basename(file))
    : file;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'launcher-state-'));
  jest.spyOn(os, 'homedir').mockReturnValue(root);
  await fs.mkdir(path.join(root, 'control'));
  for (const name of ['readFile', 'writeFile', 'rename', 'rm', 'mkdir', 'rmdir', 'stat'] as const) {
    jest.spyOn(fs, name).mockImplementation(((...args: unknown[]) => {
      args[0] = remap(args[0]);
      if (name === 'rename') {
        args[1] = remap(args[1]);
      }
      return (nativeFs[name] as (...args: unknown[]) => unknown)(...args);
    }) as never);
  }
});
afterEach(async () => {
  jest.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});

test('missing and old-boot state are unavailable, while access errors propagate', async () => {
  expect(await readLauncherStateAsync(boot)).toBeUndefined();
  await updateLauncherStateAsync('old-boot', () => ({ bootUuid: 'old-boot', status: 'disabled' }));
  expect(await readLauncherStateAsync(boot)).toBeUndefined();
  const error = Object.assign(new Error('state inaccessible'), { code: 'EACCES' });
  jest.spyOn(fs, 'readFile').mockRejectedValueOnce(error);
  await expect(readLauncherStateAsync(boot)).rejects.toBe(error);
});

test('old-boot locks are ignored without being removed or stolen', async () => {
  await fs.mkdir(`${LAUNCHER_STATE_FILE}.old-boot.lock`, { recursive: true });
  await stopAsync(boot);
  expect(await readLauncherStateAsync(boot)).toEqual({ bootUuid: boot, status: 'disabled' });
  expect((await fs.stat(`${LAUNCHER_STATE_FILE}.old-boot.lock`)).isDirectory()).toBe(true);
});

test('a current-boot crash lock times out fail-closed and remains untouched', async () => {
  const lock = `${LAUNCHER_STATE_FILE}.${boot}.lock`;
  await fs.mkdir(lock, { recursive: true });
  let calls = 0;
  jest.spyOn(Date, 'now').mockImplementation(() => (calls++ ? 5_001 : 0));
  await expect(stopAsync(boot)).rejects.toThrow('state is locked');
  expect((await fs.stat(lock)).isDirectory()).toBe(true);
  expect(await readLauncherStateAsync(boot)).toBeUndefined();
});

for (const operation of ['callback', 'writeFile', 'rename'] as const) {
  test(`${operation} failure preserves old state and releases only the owned temporary files/lock`, async () => {
    await updateLauncherStateAsync(boot, () => ({ bootUuid: boot, status: 'starting' }));
    const error = Object.assign(new Error('disk error'), { code: 'EIO' });
    if (operation !== 'callback') {
      jest.spyOn(fs, operation).mockRejectedValueOnce(error);
    }
    await expect(
      updateLauncherStateAsync(boot, state => {
        if (operation === 'callback') {
          throw error;
        }
        return { ...state!, status: 'ready' };
      })
    ).rejects.toBe(error);
    expect((await readLauncherStateAsync(boot))?.status).toBe('starting');
    expect(await fs.readdir(directory())).toEqual([path.basename(LAUNCHER_STATE_FILE)]);
  });
}

test('cancellation after the temporary write cannot publish the next state', async () => {
  await updateLauncherStateAsync(boot, () => ({ bootUuid: boot, status: 'starting' }));
  const abort = new AbortController();
  const write = nativeFs.writeFile;
  jest.spyOn(fs, 'writeFile').mockImplementation((async (file, data, ...args) => {
    await write(remap(file) as string, data, ...args);
    abort.abort(new Error('cancelled'));
  }) as typeof fs.writeFile);
  await expect(
    updateLauncherStateAsync(boot, state => ({ ...state!, status: 'ready' }), abort.signal)
  ).rejects.toThrow('cancelled');
  expect((await readLauncherStateAsync(boot))?.status).toBe('starting');
  expect(await fs.readdir(directory())).toEqual([path.basename(LAUNCHER_STATE_FILE)]);
});

test.each(['ready', 'claimed'] as const)(
  'a pending %s writer publishes complete JSON before a stop, which cannot be overwritten',
  async publication => {
    await updateLauncherStateAsync(boot, () => ({
      bootUuid: boot,
      status: publication === 'ready' ? 'starting' : 'claiming',
      engine: 'serve-sim',
      ...info,
    }));
    const writing = deferred();
    const release = deferred();
    const write = nativeFs.writeFile;
    jest.spyOn(fs, 'writeFile').mockImplementation((async (file, data, ...args) => {
      if (JSON.parse(String(data)).status === publication) {
        await write(remap(file) as string, '{"bootUuid":');
        writing.resolve();
        await release.promise;
        await write(remap(file) as string, data);
        return;
      }
      await write(remap(file) as string, data, ...args);
    }) as typeof fs.writeFile);
    const ready = updateLauncherStateAsync(boot, state => ({ ...state!, status: publication }));
    try {
      await writing.promise;
      expect((await readLauncherStateAsync(boot))?.status).toBe(
        publication === 'ready' ? 'starting' : 'claiming'
      );
      const stopping = stopAsync(boot);
      release.resolve();
      await ready;
      await waitForLauncherStateAsync(boot, state => state?.status === 'stopping', 1_000);
      await expect(
        updateLauncherStateAsync(boot, state => {
          if (state?.status !== 'ready') {
            throw new Error('stop already won');
          }
          return { ...state, status: 'claimed' };
        })
      ).rejects.toThrow('stop already won');
      await updateLauncherStateAsync(boot, state => ({ ...state!, status: 'disabled' }));
      expect(await stopping).toBe(0);
    } finally {
      release.resolve();
      await ready;
    }
  }
);

test('two job claims acquire only one ready session and the result includes its metadata', async () => {
  await updateLauncherStateAsync(boot, () => ({ bootUuid: boot, status: 'ready', ...info }));
  const output = jest.spyOn(process.stdout, 'write').mockReturnValue(true);
  const results: unknown[] = [];
  const claims = ['serve-sim', 'argent'].map(engine =>
    claimAsync(boot, engine).then(
      value => results.push(value),
      error => results.push(error)
    )
  );
  await waitForLauncherStateAsync(boot, state => state?.status === 'claiming', 1_000);
  for (let i = 0; i < 100 && results.length === 0; i++) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  expect(results[0]).toBeInstanceOf(Error);
  await updateLauncherStateAsync(boot, state => ({ ...state!, status: 'claimed' }));
  await Promise.all(claims);
  expect(results.filter(value => value === 0)).toHaveLength(1);
  expect(JSON.parse(String(output.mock.calls[0][0]))).toMatchObject({
    ...info,
    status: 'claimed',
    bootUuid: boot,
  });
  await expect(claimAsync(boot, 'serve-sim')).rejects.toThrow('available');
});

test.each([
  [undefined, undefined],
  ['unsupported', undefined],
  ['serve-sim', '   '],
])(
  'invalid claim engine/selector %s/%s cannot mutate or acquire ready state',
  async (engine, selector) => {
    await updateLauncherStateAsync(boot, () => ({ bootUuid: boot, status: 'ready', ...info }));
    const before = await readLauncherStateAsync(boot);
    await expect(claimAsync(boot, engine, selector)).rejects.toThrow(
      'Invalid Simulator session request'
    );
    expect(await readLauncherStateAsync(boot)).toEqual(before);
    expect(await fs.readdir(directory())).toEqual([path.basename(LAUNCHER_STATE_FILE)]);
  }
);

test('concurrent resource-free stops leave one disabled record without extra ownership files', async () => {
  expect(await Promise.all([stopAsync(boot), stopAsync(boot)])).toEqual([0, 0]);
  expect(await fs.readdir(directory())).toEqual([path.basename(LAUNCHER_STATE_FILE)]);
  expect(await readLauncherStateAsync(boot)).toEqual({ bootUuid: boot, status: 'disabled' });
});

test('stopping is not cleanup completion and polling stays bounded', async () => {
  await updateLauncherStateAsync(boot, () => ({
    bootUuid: boot,
    status: 'stopping',
    error: 'cleanup incomplete',
  }));
  await expect(
    waitForLauncherStateAsync(boot, state => state?.status === 'disabled', 1)
  ).rejects.toThrow('cleanup may still be running');
  expect((await readLauncherStateAsync(boot))?.status).toBe('stopping');
});
