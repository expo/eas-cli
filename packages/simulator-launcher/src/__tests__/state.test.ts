import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { claimAsync } from '../commands/claim';
import { stopAsync } from '../commands/stop';
import * as launcherState from '../utils/state';
import {
  LAUNCHER_STATE_FILE,
  readLauncherStateAsync,
  updateLauncherStateAsync,
  waitForLauncherStateAsync,
} from '../utils/state';
import { deferred, until } from './helpers';

const boot = 'boot-one';
let root: string;
const info = {
  device: { udid: 'PHONE', name: 'iPhone 17' },
  server: {
    startupDevice: 'PHONE',
    pid: 9001,
    nativeStartTime: 'native-start',
    port: 3200,
    url: 'http://127.0.0.1:3200',
    token: 'fixture-token',
  },
  controllerPid: 9000,
  controllerStartTime: 'Thu Oct 22 10:00:00 2026',
  agentDeviceStateDir: '/agent',
  argentEventLogPath: '/argent/events',
};
const directory = () => path.join(root, 'control');
const pollLauncherStateAsync = waitForLauncherStateAsync;

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

async function beginStartingClaimAsync(engine = 'serve-sim') {
  let observedStarting = false;
  jest
    .spyOn(launcherState, 'waitForLauncherStateAsync')
    .mockImplementationOnce((bootUuid, isComplete, timeoutMs) =>
      pollLauncherStateAsync(
        bootUuid,
        state => {
          const complete = isComplete(state);
          observedStarting ||= state?.status === 'starting';
          return complete;
        },
        timeoutMs
      )
    );
  const result = claimAsync(boot, engine, 'iPhone 17').then(
    value => value,
    error => error as Error
  );
  await until(() => observedStarting);
  return { result };
}

test('a claim waits for the minimal starting record to become ready without changing it', async () => {
  const starting = {
    bootUuid: boot,
    status: 'starting' as const,
    controllerPid: info.controllerPid,
    launcherVersion: '27.4.0',
  };
  await updateLauncherStateAsync(boot, () => starting);
  const output = jest.spyOn(process.stdout, 'write').mockReturnValue(true);
  const { result } = await beginStartingClaimAsync();
  expect(await readLauncherStateAsync(boot)).toEqual(starting);
  expect(await fs.readdir(directory())).toEqual([path.basename(LAUNCHER_STATE_FILE)]);
  expect(output).not.toHaveBeenCalled();

  await updateLauncherStateAsync(boot, state => ({ ...state!, ...info, status: 'ready' }));
  await waitForLauncherStateAsync(boot, state => state?.status === 'claiming', 1_000);
  await updateLauncherStateAsync(boot, state => ({ ...state!, status: 'claimed' }));
  expect(await result).toBe(0);
  expect(JSON.parse(String(output.mock.calls[0][0]))).toMatchObject({
    ...info,
    status: 'claimed',
    engine: 'serve-sim',
    requestedDevice: 'iPhone 17',
  });
});

test('two claims waiting for startup still acquire only one session', async () => {
  await updateLauncherStateAsync(boot, () => ({
    bootUuid: boot,
    status: 'starting',
    controllerPid: info.controllerPid,
  }));
  jest.spyOn(process.stdout, 'write').mockReturnValue(true);
  const first = await beginStartingClaimAsync();
  const second = await beginStartingClaimAsync('argent');
  await updateLauncherStateAsync(boot, state => ({ ...state!, ...info, status: 'ready' }));
  await waitForLauncherStateAsync(boot, state => state?.status === 'claiming', 1_000);
  await updateLauncherStateAsync(boot, state => ({ ...state!, status: 'claimed' }));
  const results = await Promise.all([first.result, second.result]);
  expect(results.filter(value => value === 0)).toHaveLength(1);
  expect(results.filter(value => value instanceof Error)).toHaveLength(1);
});

test.each(['stopping', 'disabled'] as const)(
  'a waiting claim preserves a startup failure in %s state',
  async status => {
    await updateLauncherStateAsync(boot, () => ({
      bootUuid: boot,
      status: 'starting',
      controllerPid: info.controllerPid,
    }));
    const { result } = await beginStartingClaimAsync();
    await updateLauncherStateAsync(boot, state => ({
      ...state!,
      status,
      error: 'serve-sim exited',
    }));
    expect(await result).toEqual(
      new Error(
        'Simulator preparation was interrupted; cleanup may still be running. serve-sim exited'
      )
    );
    expect((await readLauncherStateAsync(boot))?.status).toBe(status);
  }
);

test.each(['missing', 'old boot', 'different controller', 'different start time'] as const)(
  'a waiting claim cannot acquire %s state',
  async replacement => {
    await updateLauncherStateAsync(boot, () => ({
      bootUuid: boot,
      status: 'starting',
      controllerPid: info.controllerPid,
      controllerStartTime: info.controllerStartTime,
    }));
    const { result } = await beginStartingClaimAsync();
    if (replacement === 'missing') {
      await fs.rm(LAUNCHER_STATE_FILE);
    } else if (replacement === 'old boot') {
      await updateLauncherStateAsync('other-boot', () => ({
        bootUuid: 'other-boot',
        status: 'ready',
        ...info,
      }));
    } else {
      await updateLauncherStateAsync(boot, state => ({
        ...state!,
        ...info,
        status: 'ready',
        ...(replacement === 'different controller'
          ? { controllerPid: info.controllerPid + 1 }
          : { controllerStartTime: 'replacement-start' }),
      }));
    }
    expect(await result).toBeInstanceOf(Error);
    expect((await readLauncherStateAsync(boot))?.status).not.toBe('claiming');
  }
);

test('a claim rechecks controller identity under the state lock', async () => {
  await updateLauncherStateAsync(boot, () => ({ bootUuid: boot, status: 'ready', ...info }));
  jest.spyOn(fs, 'mkdir').mockImplementationOnce(async file => {
    await nativeFs.writeFile(
      remap(LAUNCHER_STATE_FILE) as string,
      JSON.stringify({ bootUuid: boot, status: 'ready', ...info, controllerPid: 9002 })
    );
    await nativeFs.mkdir(remap(file) as string);
    return undefined;
  });
  await expect(claimAsync(boot, 'serve-sim')).rejects.toThrow('different session');
  expect(await readLauncherStateAsync(boot)).toMatchObject({
    status: 'ready',
    controllerPid: 9002,
  });
});

test('startup and claim acknowledgement share one timeout', async () => {
  let now = 0;
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  await updateLauncherStateAsync(boot, () => ({
    bootUuid: boot,
    status: 'starting',
    controllerPid: info.controllerPid,
  }));
  const { result } = await beginStartingClaimAsync();
  now = 419_000;
  await updateLauncherStateAsync(boot, state => ({ ...state!, ...info, status: 'ready' }));
  await waitForLauncherStateAsync(boot, state => state?.status === 'claiming', 1_000);
  now = 420_001;
  let settled = false;
  void result.then(() => {
    settled = true;
  });
  try {
    await until(() => settled);
    expect(await result).toEqual(
      new Error('Timed out waiting for the Simulator launcher; cleanup may still be running.')
    );
  } finally {
    now = 1_000_000;
    await result;
  }
});

test('startup times out without acquiring or changing the starting record', async () => {
  let now = 0;
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  await updateLauncherStateAsync(boot, () => ({
    bootUuid: boot,
    status: 'starting',
    controllerPid: info.controllerPid,
  }));
  const { result } = await beginStartingClaimAsync();
  now = 420_001;
  expect(await result).toEqual(
    new Error('Timed out waiting for the Simulator launcher; cleanup may still be running.')
  );
  expect((await readLauncherStateAsync(boot))?.status).toBe('starting');
});

test('a claim cannot acquire after the deadline expires while taking the state lock', async () => {
  let now = 0;
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  await updateLauncherStateAsync(boot, () => ({ bootUuid: boot, status: 'ready', ...info }));
  jest.spyOn(fs, 'mkdir').mockImplementationOnce(async file => {
    now = 420_001;
    await nativeFs.mkdir(remap(file) as string);
    return undefined;
  });
  await expect(claimAsync(boot, 'serve-sim')).rejects.toThrow('Timed out');
  expect((await readLauncherStateAsync(boot))?.status).toBe('ready');
});

test.each(['missing', 'old boot', 'starting without a controller'] as const)(
  'a claim immediately rejects %s state',
  async state => {
    if (state !== 'missing') {
      const bootUuid = state === 'old boot' ? 'old-boot' : boot;
      await updateLauncherStateAsync(bootUuid, () => ({ bootUuid, status: 'starting' }));
    }
    await expect(claimAsync(boot, 'serve-sim')).rejects.toThrow('available');
  }
);

test('a claim fails when the launcher hands over a different device than requested', async () => {
  await updateLauncherStateAsync(boot, () => ({ bootUuid: boot, status: 'ready', ...info }));
  const claim = expect(claimAsync(boot, 'serve-sim', 'iPad Pro')).rejects.toThrow(
    'claimed iPhone 17, not iPad Pro'
  );
  await waitForLauncherStateAsync(boot, state => state?.status === 'claiming', 1_000);
  await updateLauncherStateAsync(boot, state => ({ ...state!, status: 'claimed' }));
  await claim;
});

test('an interrupted claim reports the launcher error', async () => {
  await updateLauncherStateAsync(boot, () => ({ bootUuid: boot, status: 'ready', ...info }));
  const claim = expect(claimAsync(boot, 'serve-sim')).rejects.toThrow(
    'cleanup may still be running. serve-sim exited'
  );
  await waitForLauncherStateAsync(boot, state => state?.status === 'claiming', 1_000);
  await updateLauncherStateAsync(boot, state => ({
    ...state!,
    status: 'stopping',
    error: 'serve-sim exited',
  }));
  await claim;
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

test('the single state record keeps server credentials private to its OS user', async () => {
  await updateLauncherStateAsync(boot, () => ({ bootUuid: boot, status: 'ready', ...info }));
  expect((await fs.stat(LAUNCHER_STATE_FILE)).mode & 0o777).toBe(0o600);
});
