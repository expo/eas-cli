import fs from 'fs-extra';
import path from 'path';
import * as tar from 'tar';

import { Client } from '../../../vcs/vcs';
import { makeProjectTarballAsync } from '../repository';

jest.mock('../../../ora', () => ({
  ora: jest.fn(() => ({
    fail: jest.fn(),
    isSpinning: false,
    start: jest.fn(),
    succeed: jest.fn(),
  })),
}));

class FakeVcsClient extends Client {
  public async makeShallowCopyAsync(destinationPath: string): Promise<void> {
    await fs.mkdirp(path.join(destinationPath, 'bin'));
    await fs.mkdirp(path.join(destinationPath, 'read-only-dir'));

    await fs.writeFile(path.join(destinationPath, 'bin', 'postcheckout.sh'), '#!/bin/sh\necho hi\n');
    await fs.writeFile(path.join(destinationPath, 'regular-file.txt'), 'regular file\n');
    await fs.writeFile(path.join(destinationPath, 'read-only-dir', 'child.txt'), 'child file\n');

    await fs.chmod(path.join(destinationPath, 'bin', 'postcheckout.sh'), 0o755);
    await fs.chmod(path.join(destinationPath, 'regular-file.txt'), 0o644);
    await fs.chmod(path.join(destinationPath, 'read-only-dir'), 0o555);
  }

  public async getRootPathAsync(): Promise<string> {
    return process.cwd();
  }

  public canGetLastCommitMessage(): boolean {
    return false;
  }
}

describe(makeProjectTarballAsync, () => {
  it('creates portable project archives while preserving executable files', async () => {
    const removeAsync = fs.remove.bind(fs);
    const removeSpy = jest.spyOn(fs, 'remove').mockImplementation(async targetPath => {
      await fs.chmod(path.join(targetPath.toString(), 'read-only-dir'), 0o755).catch(() => {});
      await removeAsync(targetPath);
    });
    const projectTarball = await makeProjectTarballAsync(new FakeVcsClient());
    const entries = new Map<string, tar.ReadEntry>();

    try {
      await tar.list({
        file: projectTarball.path,
        onentry: entry => {
          entries.set(entry.path, entry);
        },
      });

      expect(entries.get('project/bin/postcheckout.sh')?.mode).toBe(0o755);
      expect(entries.get('project/regular-file.txt')?.mode).toBe(0o644);
      expect(entries.get('project/read-only-dir/')?.mode).toBe(0o755);
      expect(entries.has('project/read-only-dir/child.txt')).toBe(true);

      for (const entry of entries.values()) {
        expect(entry.path.startsWith('project/')).toBe(true);
        expect(entry.uid).toBeUndefined();
        expect(entry.gid).toBeUndefined();
        expect(entry.uname).toBe('');
        expect(entry.gname).toBe('');
      }
    } finally {
      await fs.remove(projectTarball.path);
      removeSpy.mockRestore();
    }
  });
});
