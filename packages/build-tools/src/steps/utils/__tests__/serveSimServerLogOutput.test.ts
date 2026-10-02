import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { CircularFile, SERVE_SIM_LOG_MAX_BYTES } from '../circularFile';
import { spawnDetached } from '../remoteDeviceRunSession';

jest.unmock('node:fs');
jest.unmock('node:fs/promises');
jest.mock('../../../sentry');

it.each([0, 1])(
  'writes stdout and stderr to a private file, including exit code %s',
  async exitCode => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'serve-sim-output-test-'));
    const outputFilePath = path.join(directory, 'serve-sim.log');
    try {
      const handle = spawnDetached({
        command: process.execPath,
        args: [
          '-e',
          `console.log('stdout-marker'); console.error('stderr-marker'); process.exit(${exitCode});`,
        ],
        env: {},
        outputLog: new CircularFile(outputFilePath),
      });

      for (let tries = 0; tries < 100 && !handle.getExitError(); tries++) {
        await delay(20);
      }
      await handle.stopAsync();
      expect(handle.getExitError()?.message).toContain(`code ${exitCode}`);
      const text = await readFile(outputFilePath, 'utf8');
      expect(text).toContain('stdout-marker\n');
      expect(text).toContain('stderr-marker\n');
      expect(handle.getOutput()).toBe(text);
      expect((await stat(outputFilePath)).mode & 0o777).toBe(0o600);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
);

it('waits for descendant shutdown output even when the launcher has already exited', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'serve-sim-output-test-'));
  const outputFilePath = path.join(directory, 'serve-sim.log');
  const childScript = `
    process.on('SIGTERM', () => setTimeout(() => {
      console.error('descendant-shutdown-marker');
      process.exit(0);
    }, 150));
    console.log('descendant-ready');
    setInterval(() => {}, 1000);
  `;
  const launcherScript = `
    require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(childScript)}], { stdio: 'inherit' });
    setTimeout(() => process.exit(0), 200);
  `;
  const handle = spawnDetached({
    command: process.execPath,
    args: ['-e', launcherScript],
    env: {},
    outputLog: new CircularFile(outputFilePath),
  });
  try {
    for (let tries = 0; tries < 100 && !handle.getExitError(); tries++) {
      await delay(20);
    }
    expect(handle.getExitError()).toBeDefined();
    expect(handle.getOutput()).toContain('descendant-ready');
    await handle.stopAsync();
    expect(await readFile(outputFilePath, 'utf8')).toContain('descendant-shutdown-marker');
  } finally {
    await handle.stopAsync();
    await rm(directory, { recursive: true, force: true });
  }
}, 20_000);

it('caps the actual file and retains the latest bytes after stream draining', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'serve-sim-output-test-'));
  const output = new CircularFile(path.join(directory, 'serve-sim.log'));
  const block = Buffer.from('x'.repeat(1023) + '\n');
  const expected = Buffer.concat([
    Buffer.alloc(11 * 1024 * 1024, block),
    Buffer.from('final output\n'),
  ]);
  const handle = spawnDetached({
    command: process.execPath,
    args: [
      '-e',
      `
      process.stdout.write(Buffer.alloc(11 * 1024 * 1024, Buffer.from('x'.repeat(1023) + '\\n')), () => {
        process.stdout.write('final output\\n');
      });
    `,
    ],
    env: {},
    outputLog: output,
  });
  try {
    for (let tries = 0; tries < 200 && !handle.getExitError(); tries++) {
      expect((await stat(output.filePath)).size).toBeLessThanOrEqual(SERVE_SIM_LOG_MAX_BYTES);
      await delay(20);
    }
    expect(handle.getExitError()).toBeDefined();
    await handle.stopAsync();
    expect((await stat(output.filePath)).size).toBe(SERVE_SIM_LOG_MAX_BYTES);
    expect(output.read().equals(expected.subarray(-SERVE_SIM_LOG_MAX_BYTES))).toBe(true);
    expect(output.truncated).toBe(true);
  } finally {
    await handle.stopAsync();
    await rm(directory, { recursive: true, force: true });
  }
});

it('drains a failed spawn without waiting for a nonexistent process', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'serve-sim-output-test-'));
  const output = new CircularFile(path.join(directory, 'serve-sim.log'));
  const handle = spawnDetached({
    command: path.join(directory, 'missing'),
    args: [],
    env: {},
    outputLog: output,
  });
  try {
    await expect(handle.stopAsync()).resolves.toBeUndefined();
    expect(handle.getExitError()?.message).toContain('ENOENT');
    expect(output.read()).toHaveLength(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it('keeps draining after a disk write failure and reports it at shutdown', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'serve-sim-output-test-'));
  const output = new CircularFile(path.join(directory, 'serve-sim.log'));
  const error = new Error('disk full');
  jest.spyOn(output, 'append').mockImplementation(() => {
    throw error;
  });
  const handle = spawnDetached({
    command: process.execPath,
    args: ['-e', 'process.stdout.write(Buffer.alloc(1024 * 1024));'],
    env: {},
    outputLog: output,
  });
  try {
    for (let tries = 0; tries < 100 && !handle.getExitError(); tries++) {
      await delay(20);
    }
    expect(handle.getExitError()?.message).toContain('code 0');
    await expect(handle.stopAsync()).rejects.toBe(error);
    expect(output.append).toHaveBeenCalledTimes(1);
  } finally {
    await handle.stopAsync().catch(() => {});
    await rm(directory, { recursive: true, force: true });
  }
});
