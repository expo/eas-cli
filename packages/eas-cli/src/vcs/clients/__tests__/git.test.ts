import spawnAsync from '@expo/spawn-async';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import GitClient from '../git';

describe('git', () => {
  describe('GitClient that does not require a commit', () => {
    let vcs: GitClient;
    let repoRoot: string;

    afterAll(async () => {
      await fs.rm(repoRoot, { recursive: true, force: true });
    });

    beforeAll(async () => {
      repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-cli-git-test-'));
      await spawnAsync('git', ['init'], { cwd: repoRoot });
      vcs = new GitClient({
        requireCommit: false,
        maybeCwdOverride: repoRoot,
      });
    });

    describe('isFileIgnoredAsync', () => {
      const testFiles = [
        { commit: true, gitignore: true, easignore: true },
        { commit: true, gitignore: true, easignore: false },
        { commit: true, gitignore: false, easignore: true },
        { commit: true, gitignore: false, easignore: false },
        { commit: false, gitignore: true, easignore: true },
        { commit: false, gitignore: true, easignore: false },
        { commit: false, gitignore: false, easignore: true },
        { commit: false, gitignore: false, easignore: false },
      ].map(combo => {
        const filename = `${combo.commit ? 'tracked' : 'new'}-${
          combo.gitignore ? 'gitignored' : 'gitnonignored'
        }-${combo.easignore ? 'easignored' : 'easnonignored'}.txt`;
        return { ...combo, filename };
      });

      async function setupTestFiles(): Promise<void> {
        await Promise.all(
          testFiles.map(async file => {
            const content = `File that is ${Object.values(file).join(', ')}`;
            await fs.writeFile(`${repoRoot}/${file.filename}`, content);
          })
        );

        // Commit the "committed" files
        await spawnAsync('git', ['add', '*tracked*.txt'], { cwd: repoRoot });
        await spawnAsync('git', ['commit', '-m', 'test setup'], { cwd: repoRoot });
      }

      beforeAll(async () => {
        await setupTestFiles();
      });

      describe('with only .easignore', () => {
        beforeAll(async () => {
          await fs.writeFile(`${repoRoot}/.easignore`, '*easignored*\n');
        });

        afterAll(async () => {
          await fs.rm(`${repoRoot}/.easignore`);
        });

        it.each(testFiles.filter(file => file.easignore))(
          '$filename should be ignored',
          async file => {
            expect(await vcs.isFileIgnoredAsync(file.filename)).toBe(true);
          }
        );

        it.each(testFiles.filter(file => !file.easignore))(
          '$filename should not be ignored',
          async file => {
            expect(await vcs.isFileIgnoredAsync(file.filename)).toBe(false);
          }
        );
      });

      describe('with only .gitignore', () => {
        beforeAll(async () => {
          await fs.writeFile(`${repoRoot}/.gitignore`, '*gitignored*\n');
        });

        afterAll(async () => {
          await fs.rm(`${repoRoot}/.gitignore`);
        });

        it.each(testFiles.filter(file => file.gitignore && !file.commit))(
          '$filename should be ignored',
          async file => {
            expect(await vcs.isFileIgnoredAsync(file.filename)).toBe(true);
          }
        );

        it.each(testFiles.filter(file => !file.gitignore || file.commit))(
          '$filename should not be ignored',
          async file => {
            expect(await vcs.isFileIgnoredAsync(file.filename)).toBe(false);
          }
        );
      });

      describe('with both .gitignore and .easignore', () => {
        beforeAll(async () => {
          await fs.writeFile(`${repoRoot}/.gitignore`, '*gitignored*\n');
          await fs.writeFile(`${repoRoot}/.easignore`, '*easignored*\n');
        });

        afterAll(async () => {
          await fs.rm(`${repoRoot}/.gitignore`);
          await fs.rm(`${repoRoot}/.easignore`);
        });

        it.each(testFiles.filter(file => file.easignore))(
          '$filename should be ignored',
          async file => {
            expect(await vcs.isFileIgnoredAsync(file.filename)).toBe(true);
          }
        );

        it.each(testFiles.filter(file => !file.easignore))(
          '$filename should not be ignored',
          async file => {
            expect(await vcs.isFileIgnoredAsync(file.filename)).toBe(false);
          }
        );
      });
    });

    it('is able to delete a submodule ignored by .easignore', async () => {
      const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-cli-git-test-'));
      await spawnAsync('git', ['init'], { cwd: repoRoot });
      const vcs = new GitClient({
        requireCommit: false,
        maybeCwdOverride: repoRoot,
      });

      await spawnAsync(
        'git',
        ['submodule', 'add', 'https://github.com/expo/results.git', 'results'],
        { cwd: repoRoot }
      );
      await spawnAsync('git', ['add', 'results'], { cwd: repoRoot });
      await spawnAsync('git', ['commit', '-m', 'add submodule'], { cwd: repoRoot });

      const repoCloneNonIgnored = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-cli-git-test-'));
      await expect(vcs.makeShallowCopyAsync(repoCloneNonIgnored)).resolves.not.toThrow();
      await expect(fs.stat(path.join(repoCloneNonIgnored, 'results'))).resolves.not.toThrow();

      await fs.writeFile(`${repoRoot}/.easignore`, 'results');
      const repoCloneIgnored = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-cli-git-test-'));
      await expect(vcs.makeShallowCopyAsync(repoCloneIgnored)).resolves.not.toThrow();
      await expect(fs.stat(path.join(repoCloneIgnored, 'results'))).rejects.toThrow('ENOENT');
    });
  });

  it('does not include files that have been removed in the working directory', async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-cli-git-test-'));
    await spawnAsync('git', ['init'], { cwd: repoRoot });
    const vcs = new GitClient({
      requireCommit: false,
      maybeCwdOverride: repoRoot,
    });

    await fs.writeFile(`${repoRoot}/committed-file.txt`, 'file');
    await fs.writeFile(`${repoRoot}/file-to-remove.txt`, 'file');
    await spawnAsync('git', ['add', 'committed-file.txt', 'file-to-remove.txt'], {
      cwd: repoRoot,
    });
    await spawnAsync('git', ['commit', '-m', 'add files'], { cwd: repoRoot });

    await fs.rm(`${repoRoot}/file-to-remove.txt`);
    await spawnAsync('git', ['add', 'file-to-remove.txt'], { cwd: repoRoot });
    await spawnAsync('git', ['commit', '-m', 'remove file'], { cwd: repoRoot });

    await fs.writeFile(`${repoRoot}/new-file.txt`, 'file');
    await fs.writeFile(`${repoRoot}/new-tracked-file.txt`, 'file');

    const repoClone = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-cli-git-test-'));
    await expect(vcs.makeShallowCopyAsync(repoClone)).resolves.not.toThrow();
    await expect(fs.stat(path.join(repoClone, 'file-to-remove.txt'))).rejects.toThrow('ENOENT');
    await expect(fs.stat(path.join(repoClone, 'committed-file.txt'))).resolves.not.toThrow();
    await expect(fs.stat(path.join(repoClone, 'new-file.txt'))).resolves.not.toThrow();
    await expect(fs.stat(path.join(repoClone, 'new-tracked-file.txt'))).resolves.not.toThrow();

    vcs.requireCommit = true;
    await spawnAsync('git', ['add', '.'], { cwd: repoRoot });
    await spawnAsync('git', ['commit', '-m', 'tmp commit'], { cwd: repoRoot });

    const requireCommitClone = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-cli-git-test-'));
    await expect(vcs.makeShallowCopyAsync(requireCommitClone)).resolves.not.toThrow();
    await expect(fs.stat(path.join(requireCommitClone, 'file-to-remove.txt'))).rejects.toThrow(
      'ENOENT'
    );
    await expect(
      fs.stat(path.join(requireCommitClone, 'committed-file.txt'))
    ).resolves.not.toThrow();
    await expect(fs.stat(path.join(requireCommitClone, 'new-file.txt'))).resolves.not.toThrow();
    await expect(
      fs.stat(path.join(requireCommitClone, 'new-tracked-file.txt'))
    ).resolves.not.toThrow();
  });
});
