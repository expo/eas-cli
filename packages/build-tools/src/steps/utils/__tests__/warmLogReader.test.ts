import type { bunyan } from '@expo/logger';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { followWarmLog } from '../warmLogReader';

jest.unmock('node:fs');
jest.unmock('node:fs/promises');

let directory: string;
let file: string;

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-warm-log-'));
  file = path.join(directory, 'service.log');
});

afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true });
});

it('forwards only new output on the original file and drains it on stop', async () => {
  await fs.writeFile(file, 'before adoption\n');
  const writer = await fs.open(file, 'a');
  const info = jest.fn();
  const warn = jest.fn();
  const logger = { info, warn } as unknown as bunyan;
  const reader = followWarmLog({ file, logger, secrets: ['session-secret'] });
  try {
    await writer.write('adoption session-secret\n');
    await fs.rename(file, path.join(directory, 'original.log'));
    await fs.writeFile(file, 'unrelated replacement\n');
    await writer.write('shutdown output');
    const stopping = reader.stopAsync();
    expect(reader.stopAsync()).toBe(stopping);
    await stopping;
    expect(info.mock.calls).toEqual([
      [{ source: 'stdout' }, 'adoption [REDACTED]'],
      [{ source: 'stdout' }, 'shutdown output'],
    ]);
    expect(reader.getOutput()).toBe('adoption [REDACTED]\nshutdown output\n');
    expect(warn).not.toHaveBeenCalled();
  } finally {
    await writer.close();
    await reader.stopAsync();
  }
});

it('rejects symlinks and non-regular files before starting to read', async () => {
  const logger = { info: jest.fn(), warn: jest.fn() } as unknown as bunyan;
  await fs.writeFile(path.join(directory, 'other.log'), 'unrelated data');
  await fs.symlink(path.join(directory, 'other.log'), file);
  expect(() => followWarmLog({ file, logger, secrets: [] })).toThrow();
  expect(() => followWarmLog({ file: directory, logger, secrets: [] })).toThrow(
    'The warm log is not a regular file.'
  );
  expect(logger.info).not.toHaveBeenCalled();
});

it('warns once and stops reading if the open file is truncated', async () => {
  const info = jest.fn();
  let warned!: () => void;
  const warning = new Promise<void>(resolve => {
    warned = resolve;
  });
  const warn = jest.fn(warned);
  const logger = { info, warn } as unknown as bunyan;
  await fs.writeFile(file, 'before adoption\n');
  const reader = followWarmLog({ file, logger, secrets: [] });
  try {
    await fs.writeFile(file, 'replaced\n');
    await warning;
    expect(warn.mock.calls).toEqual([
      [
        { err: new Error('The warm log was truncated while forwarding.') },
        'Could not read the warm service log.',
      ],
    ]);
    expect(info).not.toHaveBeenCalled();
  } finally {
    await reader.stopAsync();
  }
});
