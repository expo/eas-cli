import { type bunyan } from '@expo/logger';
import { setTimeout as delay } from 'node:timers/promises';

import { spawnDetached } from '../remoteDeviceRunSession';

jest.unmock('node:fs');
jest.unmock('node:fs/promises');
jest.mock('../../../sentry');

it.each([0, 1])(
  'streams redacted stdout/stderr and drains final partial output on exit %s',
  async exitCode => {
    const logger = { info: jest.fn() } as unknown as bunyan;
    const handle = spawnDetached({
      command: process.execPath,
      args: [
        '-e',
        `
      console.log('stdout-marker');
      console.error('https://preview.test/?token=startup-secret');
      process.stdout.write('argent link argent://startup-');
      setTimeout(() => {
        console.log('secret@127.0.0.1:5678');
        console.log('argent link --host 127.0.0.1 --port 5678 --token startup-secret');
      }, 25);
      setTimeout(() => {
        process.stderr.write('final diagnostic');
        process.exit(${exitCode});
      }, 100);
    `,
      ],
      env: {},
      logger,
    });
    try {
      for (let tries = 0; tries < 100 && !handle.getExitError(); tries++) {
        await delay(20);
      }
      await handle.stopAsync();
      expect(handle.getExitError()?.message).toContain(`code ${exitCode}`);
      expect(logger.info).toHaveBeenCalledWith({ source: 'stdout' }, 'stdout-marker');
      expect(logger.info).toHaveBeenCalledWith(
        { source: 'stderr' },
        'https://preview.test/?token=[REDACTED]'
      );
      expect(logger.info).toHaveBeenCalledWith({ source: 'stderr' }, 'final diagnostic');
      expect(logger.info).toHaveBeenCalledWith(
        { source: 'stdout' },
        'argent link argent://[REDACTED]@127.0.0.1:5678'
      );
      expect(logger.info).toHaveBeenCalledWith(
        { source: 'stdout' },
        'argent link --host 127.0.0.1 --port 5678 --token [REDACTED]'
      );
      expect(JSON.stringify(jest.mocked(logger.info).mock.calls)).not.toContain('startup-secret');
      expect(handle.getOutput()).not.toContain('startup-secret');
    } finally {
      await handle.stopAsync();
    }
  }
);

it('drains descendant shutdown logs after the launcher has exited', async () => {
  const logger = { info: jest.fn() } as unknown as bunyan;
  const childScript = `
    process.on('SIGTERM', () => setTimeout(() => {
      console.error('descendant-shutdown-marker'); process.exit(0);
    }, 150));
    console.log('descendant-ready'); setInterval(() => {}, 1000);
  `;
  const handle = spawnDetached({
    command: process.execPath,
    args: [
      '-e',
      `
      require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(childScript)}], { stdio: 'inherit' });
      setTimeout(() => process.exit(0), 200);
    `,
    ],
    env: {},
    logger,
  });
  try {
    for (let tries = 0; tries < 100 && !handle.getExitError(); tries++) {
      await delay(20);
    }
    expect(handle.getExitError()).toBeDefined();
    await handle.stopAsync();
    expect(logger.info).toHaveBeenCalledWith({ source: 'stderr' }, 'descendant-shutdown-marker');
  } finally {
    await handle.stopAsync();
  }
}, 20_000);

it('fails a stop whose output a detached descendant still holds open, after flushing it', async () => {
  const logger = { info: jest.fn() } as unknown as bunyan;
  const lines = (source: string) =>
    jest
      .mocked(logger.info)
      .mock.calls.filter(([fields]) => (fields as { source: string }).source === source)
      .map(([, line]) => line as unknown as string);
  // The descendant leaves the process group and keeps the inherited pipes until killed.
  const escapedScript = `
    process.stderr.on('error', () => {});
    setInterval(() => console.error('escaped-tick'), 50);
    setTimeout(() => process.exit(0), 30_000);
  `;
  const handle = spawnDetached({
    command: process.execPath,
    args: [
      '-e',
      `
      const escaped = require('node:child_process').spawn(
        process.execPath,
        ['-e', ${JSON.stringify(escapedScript)}],
        { stdio: 'inherit', detached: true }
      );
      console.error('escaped-pid ' + escaped.pid);
      process.stdout.write('launcher partial');
      setInterval(() => {}, 1000);
    `,
    ],
    env: {},
    logger,
  });
  let escapedPid: number | undefined;
  try {
    for (let tries = 0; tries < 100; tries++) {
      const pidLine = lines('stderr').find(line => line.startsWith('escaped-pid '));
      escapedPid = pidLine ? Number(pidLine.split(' ')[1]) : undefined;
      if (escapedPid !== undefined && lines('stderr').includes('escaped-tick')) {
        break;
      }
      await delay(20);
    }
    expect(escapedPid).toBeDefined();
    expect(lines('stdout')).toEqual([]);

    await expect(handle.stopAsync()).rejects.toThrow(
      'Process output drain timed out after 5000ms.'
    );
    expect(handle.getExitError()?.message).toBe('Process exited with signal SIGTERM.');
    expect(lines('stdout')).toEqual(['launcher partial']);
    expect(handle.getOutput()).toContain('launcher partial');
    const ticks = lines('stderr').length;
    await delay(250);
    expect(lines('stderr')).toHaveLength(ticks);
  } finally {
    if (escapedPid !== undefined) {
      try {
        process.kill(escapedPid, 'SIGKILL');
      } catch {}
    }
    await handle.stopAsync().catch(() => {});
  }
}, 20_000);
