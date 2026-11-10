import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleepAsync } from 'node:timers/promises';

import { commands } from '../utils/processes';
import { until } from './helpers';

test.each(['running', 'exit'])(
  'cancellation drains the downloader after parent=%s',
  async mode => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'owned-download-'));
    const controller = new AbortController();
    const result = commands
      .runOwnedAsync(
        process.execPath,
        [path.join(__dirname, 'fixtures/download-parent.cjs'), directory, mode],
        controller.signal
      )
      .catch(error => error);
    try {
      const pidFile = path.join(directory, 'child.pid');
      await until(() => fs.existsSync(pidFile));
      const pid = Number(fs.readFileSync(pidFile, 'utf8'));
      controller.abort(new Error('cancelled'));
      expect(await result).toMatchObject({ message: 'cancelled' });
      expect(() => process.kill(pid, 0)).toThrow();
      await sleepAsync(1100);
      expect(fs.existsSync(path.join(directory, 'late-write'))).toBe(false);
      expect(() => commands.throwIfCommandCloseTimedOut()).not.toThrow();
    } finally {
      controller.abort();
      await result;
      fs.rmSync(directory, { recursive: true, force: true });
    }
  },
  10_000
);

test('a failed executable preserves its spawn error', async () => {
  await expect(
    commands.runOwnedAsync('/missing-simulator-prefetch-command', [], new AbortController().signal)
  ).rejects.toMatchObject({ code: 'ENOENT' });
});

test('already cancelled preparation starts no command', async () => {
  const start = jest.spyOn(commands, 'start');
  try {
    await expect(
      commands.runOwnedAsync('unused', [], AbortSignal.abort(new Error('cancelled')))
    ).rejects.toThrow('cancelled');
    expect(start).not.toHaveBeenCalled();
  } finally {
    start.mockRestore();
  }
});
