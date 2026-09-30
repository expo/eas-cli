import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import { makeShallowCopyAsync } from '../local';

jest.unmock('fs');

describe(makeShallowCopyAsync, () => {
  let temporaryDirectory: string;

  beforeEach(async () => {
    temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-local-copy-'));
  });

  afterEach(async () => {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  });

  it('copies nested projects while respecting file and directory ignore rules', async () => {
    const source = path.join(temporaryDirectory, 'source');
    const destination = path.join(temporaryDirectory, 'destination');
    const files = {
      '.gitignore': 'root-ignored.txt\n',
      'root-ignored.txt': 'ignored at the root',
      'node_modules/module/index.js': 'ignored dependency',
      'packages/app/.gitignore': 'ignored.txt\ndist/\n',
      'packages/app/included.txt': 'included file',
      'packages/app/ignored.txt': 'ignored file',
      'packages/app/dist/index.js': 'ignored build output',
      'packages/other/included.txt': 'included sibling',
    };
    for (const [relativePath, contents] of Object.entries(files)) {
      const filePath = path.join(source, relativePath);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, contents);
    }

    await makeShallowCopyAsync(source, destination);

    await expect(
      fs.readFile(path.join(destination, 'packages/app/included.txt'), 'utf8')
    ).resolves.toBe('included file');
    await expect(
      fs.readFile(path.join(destination, 'packages/other/included.txt'), 'utf8')
    ).resolves.toBe('included sibling');
    for (const relativePath of [
      'root-ignored.txt',
      'node_modules',
      'packages/app/ignored.txt',
      'packages/app/dist',
    ]) {
      await expect(fs.stat(path.join(destination, relativePath))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    }
  });
});
