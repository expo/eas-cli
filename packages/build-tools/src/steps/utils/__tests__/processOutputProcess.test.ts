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
