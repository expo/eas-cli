import spawnAsync from '@expo/spawn-async';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import Log from '../../../log';
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

    it('if .git is present in .easignore', async () => {
      const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-cli-git-test-'));
      await spawnAsync('git', ['init'], { cwd: repoRoot });
      const vcs = new GitClient({
        requireCommit: false,
        maybeCwdOverride: repoRoot,
      });

      await fs.writeFile(`${repoRoot}/.easignore`, '.git\n');

      await spawnAsync('git', ['add', '.'], { cwd: repoRoot });
      await spawnAsync('git', ['commit', '-m', 'temp commit'], { cwd: repoRoot });

      const repoClone = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-cli-git-test-'));
      await expect(vcs.makeShallowCopyAsync(repoClone)).resolves.not.toThrow();
      await expect(fs.stat(path.join(repoClone, '.git'))).rejects.toThrow('ENOENT');
    });

    it('if .git is not present in .easignore', async () => {
      const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-cli-git-test-'));
      await spawnAsync('git', ['init'], { cwd: repoRoot });
      const vcs = new GitClient({
        requireCommit: false,
        maybeCwdOverride: repoRoot,
      });

      await fs.writeFile(`${repoRoot}/.easignore`, '');

      await spawnAsync('git', ['add', '.'], { cwd: repoRoot });
      await spawnAsync('git', ['commit', '-m', 'temp commit'], { cwd: repoRoot });

      const repoClone = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-cli-git-test-'));
      await expect(vcs.makeShallowCopyAsync(repoClone)).resolves.not.toThrow();
      await expect(fs.readdir(path.join(repoClone, '.git'))).resolves.toBeDefined();
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

  it('does not include files ignored in $GIT_DIR/info/exclude', async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-cli-git-test-'));
    await spawnAsync('git', ['init'], { cwd: repoRoot });
    const vcs = new GitClient({
      requireCommit: false,
      maybeCwdOverride: repoRoot,
    });

    await fs.writeFile(`${repoRoot}/committed-file.txt`, 'file');
    await spawnAsync('git', ['add', '.'], { cwd: repoRoot });
    await spawnAsync('git', ['commit', '-m', 'add file'], { cwd: repoRoot });

    await fs.mkdir(`${repoRoot}/locally-excluded-dir`);
    await fs.writeFile(`${repoRoot}/locally-excluded-dir/file.txt`, 'file');
    await fs.writeFile(`${repoRoot}/locally-excluded-file.txt`, 'file');
    await fs.writeFile(
      `${repoRoot}/.git/info/exclude`,
      'locally-excluded-dir/\nlocally-excluded-file.txt\n'
    );

    const repoClone = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-cli-git-test-'));
    await expect(vcs.makeShallowCopyAsync(repoClone)).resolves.not.toThrow();
    await expect(fs.stat(path.join(repoClone, 'locally-excluded-dir'))).rejects.toThrow('ENOENT');
    await expect(fs.stat(path.join(repoClone, 'locally-excluded-file.txt'))).rejects.toThrow(
      'ENOENT'
    );
    await expect(fs.stat(path.join(repoClone, 'committed-file.txt'))).resolves.not.toThrow();
  });

  it('does not include files ignored in core.excludesFile', async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-cli-git-test-'));
    await spawnAsync('git', ['init'], { cwd: repoRoot });
    const vcs = new GitClient({
      requireCommit: false,
      maybeCwdOverride: repoRoot,
    });

    const globalExcludesFile = path.join(repoRoot, '..', `${path.basename(repoRoot)}-excludes`);
    await fs.writeFile(globalExcludesFile, 'globally-excluded-file.txt\n');
    await spawnAsync('git', ['config', 'core.excludesFile', globalExcludesFile], { cwd: repoRoot });

    await fs.writeFile(`${repoRoot}/committed-file.txt`, 'file');
    await spawnAsync('git', ['add', 'committed-file.txt'], { cwd: repoRoot });
    await spawnAsync('git', ['commit', '-m', 'add file'], { cwd: repoRoot });
    await fs.writeFile(`${repoRoot}/globally-excluded-file.txt`, 'file');

    const repoClone = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-cli-git-test-'));
    await expect(vcs.makeShallowCopyAsync(repoClone)).resolves.not.toThrow();
    await expect(fs.stat(path.join(repoClone, 'globally-excluded-file.txt'))).rejects.toThrow(
      'ENOENT'
    );
    await expect(fs.stat(path.join(repoClone, 'committed-file.txt'))).resolves.not.toThrow();
  });

  it('does not include files ignored inside a submodule', async () => {
    const submoduleRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-cli-git-test-'));
    await spawnAsync('git', ['init'], { cwd: submoduleRoot });
    await fs.writeFile(`${submoduleRoot}/.gitignore`, 'build/\n');
    await fs.writeFile(`${submoduleRoot}/source.txt`, 'file');
    await spawnAsync('git', ['add', '.'], { cwd: submoduleRoot });
    await spawnAsync('git', ['commit', '-m', 'add source'], { cwd: submoduleRoot });

    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-cli-git-test-'));
    await spawnAsync('git', ['init'], { cwd: repoRoot });
    const vcs = new GitClient({
      requireCommit: false,
      maybeCwdOverride: repoRoot,
    });

    await spawnAsync(
      'git',
      // Local submodules are refused unless the file protocol is allowed.
      ['-c', 'protocol.file.allow=always', 'submodule', 'add', submoduleRoot, 'submodule'],
      { cwd: repoRoot }
    );
    await spawnAsync('git', ['commit', '-m', 'add submodule'], { cwd: repoRoot });

    await fs.mkdir(`${repoRoot}/submodule/build`);
    await fs.writeFile(`${repoRoot}/submodule/build/artifact.txt`, 'file');

    const repoClone = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-cli-git-test-'));
    await expect(vcs.makeShallowCopyAsync(repoClone)).resolves.not.toThrow();
    await expect(fs.stat(path.join(repoClone, 'submodule/build'))).rejects.toThrow('ENOENT');
    await expect(fs.stat(path.join(repoClone, 'submodule/source.txt'))).resolves.not.toThrow();
  });

  it('includes tracked files that match a .gitignore rule', async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-cli-git-test-'));
    await spawnAsync('git', ['init'], { cwd: repoRoot });
    const vcs = new GitClient({
      requireCommit: false,
      maybeCwdOverride: repoRoot,
    });

    await fs.writeFile(`${repoRoot}/.gitignore`, '*.env\n');
    await fs.writeFile(`${repoRoot}/tracked.env`, 'file');
    await fs.writeFile(`${repoRoot}/untracked.env`, 'file');
    await spawnAsync('git', ['add', '--force', '.gitignore', 'tracked.env'], { cwd: repoRoot });
    await spawnAsync('git', ['commit', '-m', 'add files'], { cwd: repoRoot });

    const repoClone = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-cli-git-test-'));
    await expect(vcs.makeShallowCopyAsync(repoClone)).resolves.not.toThrow();
    await expect(fs.stat(path.join(repoClone, 'tracked.env'))).resolves.not.toThrow();
    await expect(fs.stat(path.join(repoClone, 'untracked.env'))).rejects.toThrow('ENOENT');
  });

  describe('when requireCommit is true', () => {
    it('adheres to .easignore', async () => {
      const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-cli-git-test-'));
      await spawnAsync('git', ['init'], { cwd: repoRoot });
      const vcs = new GitClient({
        requireCommit: true,
        maybeCwdOverride: repoRoot,
      });

      const warn = jest.spyOn(Log, 'warn');

      await fs.writeFile(`${repoRoot}/.easignore`, '*easignored*\n');
      await fs.writeFile(`${repoRoot}/.gitignore`, '*gitignored*\n');

      await fs.writeFile(`${repoRoot}/easignored-file.txt`, 'file');
      await fs.writeFile(`${repoRoot}/nonignored-file.txt`, 'file');
      await fs.writeFile(`${repoRoot}/gitignored-file.txt`, 'file');
      await spawnAsync('git', ['add', '.'], { cwd: repoRoot });
      await spawnAsync('git', ['commit', '-m', 'tmp commit'], { cwd: repoRoot });

      const copyRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-cli-git-test-'));
      await expect(vcs.makeShallowCopyAsync(copyRoot)).resolves.not.toThrow();

      expect(warn).toHaveBeenCalledWith(expect.stringContaining('.easignore'));

      await expect(fs.stat(path.join(copyRoot, 'easignored-file.txt'))).rejects.toThrow('ENOENT');
      await expect(fs.stat(path.join(copyRoot, 'gitignored-file.txt'))).rejects.toThrow('ENOENT');
      await expect(fs.stat(path.join(copyRoot, 'nonignored-file.txt'))).resolves.not.toThrow();
    });

    it('prints a warning only once if .easignore exists', async () => {
      const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-cli-git-test-'));
      await spawnAsync('git', ['init'], { cwd: repoRoot });
      const vcs = new GitClient({
        requireCommit: true,
        maybeCwdOverride: repoRoot,
      });

      const warn = jest.spyOn(Log, 'warn');

      await fs.writeFile(`${repoRoot}/.easignore`, '*easignored*\n');
      await spawnAsync('git', ['add', '.'], { cwd: repoRoot });
      await spawnAsync('git', ['commit', '-m', 'tmp commit'], { cwd: repoRoot });

      const copyRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-cli-git-test-'));
      await expect(vcs.makeShallowCopyAsync(copyRoot)).resolves.not.toThrow();

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('.easignore'));

      const anotherCopyRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-cli-git-test-'));
      await expect(vcs.makeShallowCopyAsync(anotherCopyRoot)).resolves.not.toThrow();

      expect(warn).toHaveBeenCalledTimes(1);
    });

    describe('when EAS_SUPPRESS_REQUIRE_COMMIT_EASIGNORE_WARNING is set', () => {
      beforeAll(() => {
        process.env.EAS_SUPPRESS_REQUIRE_COMMIT_EASIGNORE_WARNING = '1';
      });

      afterAll(() => {
        delete process.env.EAS_SUPPRESS_REQUIRE_COMMIT_EASIGNORE_WARNING;
      });

      it('does not print a warning', async () => {
        const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-cli-git-test-'));
        await spawnAsync('git', ['init'], { cwd: repoRoot });
        const vcs = new GitClient({
          requireCommit: true,
          maybeCwdOverride: repoRoot,
        });

        const warn = jest.spyOn(Log, 'warn');
        warn.mockClear();

        await fs.writeFile(`${repoRoot}/.easignore`, '*easignored*\n');
        await spawnAsync('git', ['add', '.'], { cwd: repoRoot });
        await spawnAsync('git', ['commit', '-m', 'tmp commit'], { cwd: repoRoot });

        const copyRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-cli-git-test-'));
        await expect(vcs.makeShallowCopyAsync(copyRoot)).resolves.not.toThrow();

        expect(warn).toHaveBeenCalledTimes(0);
      });
    });
  });
});
