import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { preparePreinstalledWdaAsync } from '../preinstalledWda';

jest.unmock('node:fs');
jest.unmock('@expo/turtle-spawn');
jest.unmock('@expo/logger');

const realSetTimeout = setTimeout;
const realClearTimeout = clearTimeout;
const sleep = (ms: number): Promise<void> => new Promise(resolve => realSetTimeout(resolve, ms));

async function waitUntil(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error('Subprocess fixture did not reach the expected state');
    }
    await sleep(20);
  }
}

function isRunning(pid: number): boolean {
  try {
    // Orphaned descendants can remain zombies until init reaps them.
    const state = execFileSync('ps', ['-p', String(pid), '-o', 'stat='])
      .toString()
      .trim();
    return state.length > 0 && !state.startsWith('Z');
  } catch {
    return false;
  }
}

it('kills a stalled downloader and its descendants before fallback removes the artifact', async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'wda-download-timeout-'));
  const appiumHome = path.join(root, 'appium');
  const outdir = path.join(appiumHome, 'preinstalled-wda');
  const pidFiles = ['parent', 'child', 'grandchild'].map(name => path.join(root, `${name}.pid`));
  const executable = path.join(root, 'appium.cjs');
  const logger = { child: () => logger, info: jest.fn(), warn: jest.fn() };
  let preparation: Promise<Record<string, unknown>> | undefined;
  let fallbackDeadline: NodeJS.Timeout | undefined;
  try {
    await fs.promises.mkdir(outdir, { recursive: true });
    await fs.promises.writeFile(path.join(outdir, 'incomplete'), 'partial download');
    await fs.promises.writeFile(path.join(appiumHome, 'keep'), 'unrelated');
    await fs.promises.writeFile(
      executable,
      `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const {spawn} = require('node:child_process');
const role = process.argv[2] === 'driver' ? 'parent' : process.argv[2];
const outdir = role === 'parent' ? process.argv[process.argv.indexOf('--outdir') + 1] : process.argv[3];
fs.writeFileSync(path.join(__dirname, role + '.pid'), String(process.pid));
if (role !== 'grandchild') {
  spawn(process.execPath, [__filename, role === 'parent' ? 'child' : 'grandchild', outdir], {stdio: 'inherit'});
}
setInterval(() => {
  if (role === 'grandchild') {
    fs.mkdirSync(outdir, {recursive: true});
    fs.writeFileSync(path.join(outdir, 'incomplete'), 'still downloading');
  }
}, 50);
`
    );
    await fs.promises.chmod(executable, 0o700);
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'Date'] });
    preparation = preparePreinstalledWdaAsync({
      runtimeIdentifier: 'com.apple.CoreSimulator.SimRuntime.iOS-26-5',
      appiumHome,
      appiumBinPath: executable,
      appiumEnv: {},
      logger: logger as never,
    });
    await waitUntil(() => pidFiles.every(file => fs.existsSync(file)));
    const pids = pidFiles.map(file => Number(fs.readFileSync(file, 'utf8')));
    expect(pids.every(isRunning)).toBe(true);

    jest.advanceTimersByTime(60_000);
    await expect(
      Promise.race([
        preparation,
        new Promise((_, reject) => {
          fallbackDeadline = realSetTimeout(
            () => reject(new Error('Fallback remained blocked by inherited downloader pipes')),
            2_000
          );
        }),
      ])
    ).resolves.toEqual({});
    expect(logger.warn.mock.calls[0]?.[0].err.signal).toBe('SIGKILL');
    await waitUntil(() => pids.every(pid => !isRunning(pid)));
    await sleep(100);
    expect(fs.existsSync(outdir)).toBe(false);
    expect(fs.readFileSync(path.join(appiumHome, 'keep'), 'utf8')).toBe('unrelated');
    expect(logger.warn).toHaveBeenCalled();
  } finally {
    realClearTimeout(fallbackDeadline);
    jest.useRealTimers();
    // Also clean up the fixture if an assertion fails before the timeout fires.
    for (const file of pidFiles) {
      if (fs.existsSync(file)) {
        try {
          const pid = Number(fs.readFileSync(file, 'utf8'));
          if (isRunning(pid)) {
            process.kill(pid, 'SIGKILL');
          }
        } catch {}
      }
    }
    await preparation?.catch(() => {});
    await fs.promises.rm(root, { recursive: true, force: true });
  }
}, 10_000);
