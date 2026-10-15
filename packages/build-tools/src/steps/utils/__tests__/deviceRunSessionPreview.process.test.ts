import * as turtleSpawn from '@expo/turtle-spawn';
import { execFileSync } from 'node:child_process';
import { getEventListeners } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ensureMacosPreviewEncoderInstalledAsync } from '../deviceRunSessionPreview';

jest.unmock('node:fs');
jest.unmock('node:fs/promises');
jest.unmock('@expo/turtle-spawn');
jest.unmock('@expo/logger');

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

async function waitUntil(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error('Encoder subprocess fixture did not reach the expected state');
    }
    await sleep(20);
  }
}

function isRunning(pid: number): boolean {
  try {
    const state = execFileSync('ps', ['-p', String(pid), '-o', 'stat='])
      .toString()
      .trim();
    return state.length > 0 && !state.startsWith('Z');
  } catch {
    return false;
  }
}

it('aborts the installer group and drains inherited output before setup settles', async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'preview-encoder-abort-'));
  const controller = new AbortController();
  const logger = { child: () => logger, info: jest.fn() };
  const pidFiles = ['parent', 'child', 'grandchild'].map(role => path.join(root, `${role}.pid`));
  const spawn = jest.spyOn(turtleSpawn, 'default');
  let preparation: Promise<unknown> | undefined;
  let deadline: NodeJS.Timeout | undefined;
  try {
    await fs.promises.writeFile(
      path.join(root, 'cwebp'),
      `#!${process.execPath}
process.exit(1);
`,
      {
        mode: 0o700,
      }
    );
    await fs.promises.writeFile(
      path.join(root, 'brew'),
      `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const {spawn} = require('node:child_process');
const role = process.argv[2] === 'install' ? 'parent' : process.argv[2];
const pidFile = path.join(__dirname, role + '.pid');
fs.writeFileSync(pidFile + '.tmp', String(process.pid));
fs.renameSync(pidFile + '.tmp', pidFile);
if (role !== 'grandchild') {
  spawn(process.execPath, [__filename, role === 'parent' ? 'child' : 'grandchild'], {stdio: 'inherit'});
}
process.stdout.write(role + '-ready\\n');
setInterval(() => {}, 1000);
`,
      { mode: 0o700 }
    );
    preparation = ensureMacosPreviewEncoderInstalledAsync({
      env: { PATH: root },
      logger: logger as never,
      signal: controller.signal,
    }).then(
      () => ({ ok: true }),
      error => ({ error })
    );
    await waitUntil(() => pidFiles.every(file => fs.existsSync(file)));
    await expect(spawn.mock.results[0].value).rejects.toMatchObject({ status: 1 });
    const pids = pidFiles.map(file => Number(fs.readFileSync(file, 'utf8')));
    expect(pids.every(isRunning)).toBe(true);
    const installer = spawn.mock.results[1].value as ReturnType<typeof turtleSpawn.default>;
    let closed = false;
    let drained = false;
    installer.child.once('close', () => {
      closed = true;
    });
    installer.child.stdout!.once('end', () => {
      drained = true;
    });
    controller.abort(new Error('preview phase ended'));
    const result = await Promise.race([
      preparation,
      new Promise((_, reject) => {
        deadline = setTimeout(
          () => reject(new Error('Encoder cancellation did not close inherited output pipes')),
          3_000
        );
      }),
    ]);
    expect(result).toEqual({ error: expect.objectContaining({ signal: 'SIGKILL' }) });
    expect(closed).toBe(true);
    expect(drained).toBe(true);
    await waitUntil(() => pids.every(pid => !isRunning(pid)));
    expect(getEventListeners(controller.signal, 'abort')).toEqual([]);
    expect(spawn.mock.calls.map(([command]) => command)).toEqual(['cwebp', 'brew']);
    expect(spawn.mock.calls.every(([, , options]) => options?.detached && !options.signal)).toBe(
      true
    );
  } finally {
    clearTimeout(deadline);
    controller.abort();
    for (const file of pidFiles) {
      if (fs.existsSync(file)) {
        const pid = Number(fs.readFileSync(file, 'utf8'));
        if (!Number.isSafeInteger(pid) || pid <= 0) {
          continue;
        }
        try {
          process.kill(-pid, 'SIGKILL');
        } catch {}
        if (isRunning(pid)) {
          try {
            process.kill(pid, 'SIGKILL');
          } catch {}
        }
      }
    }
    await preparation;
    spawn.mockRestore();
    await fs.promises.rm(root, { recursive: true, force: true });
  }
}, 10_000);
