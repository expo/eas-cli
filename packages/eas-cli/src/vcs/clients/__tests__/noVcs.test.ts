import spawnAsync from '@expo/spawn-async';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import NoVcsClient from '../noVcs';

describe('noVcs', () => {
  describe('NoVcsClient', () => {
    let vcs: NoVcsClient;
    let repoRoot: string;
    let globalEasProjectRoot: string | undefined;

    afterEach(async () => {
      await fs.rm(repoRoot, { recursive: true, force: true });
      process.env.EAS_PROJECT_ROOT = globalEasProjectRoot;
    });

    beforeEach(async () => {
      repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-cli-git-test-'));

      vcs = new NoVcsClient({ cwdOverride: repoRoot });
      globalEasProjectRoot = process.env.EAS_PROJECT_ROOT;
      delete process.env.EAS_PROJECT_ROOT;
    });

    it('should return cwdOverride when not in Git repository', async () => {
      expect(await vcs.getRootPathAsync()).toBe(repoRoot);
    });

    it('should return the Git root when in Git repository', async () => {
      await spawnAsync('git', ['init'], { cwd: repoRoot });
      expect(await fs.realpath(await vcs.getRootPathAsync())).toBe(await fs.realpath(repoRoot));
    });

    it('should return the project root when EAS_PROJECT_ROOT is set', async () => {
      process.env.EAS_PROJECT_ROOT = 'project-root';
      expect(await vcs.getRootPathAsync()).toBe(path.resolve(repoRoot, 'project-root'));

      process.env.EAS_PROJECT_ROOT = '/app';
      expect(await vcs.getRootPathAsync()).toBe('/app');
    });

    it('isFileIgnoredAsync reads .easignore next to the project, not only at the git root', async () => {
      await spawnAsync('git', ['init'], { cwd: repoRoot });
      const projectDir = path.join(repoRoot, 'apps', 'app-a');
      await fs.mkdir(projectDir, { recursive: true });
      await fs.writeFile(path.join(projectDir, '.easignore'), 'secret.txt\n');
      await fs.writeFile(path.join(repoRoot, 'secret.txt'), 'secret');
      await fs.writeFile(path.join(repoRoot, 'kept.txt'), 'kept');

      vcs = new NoVcsClient({ cwdOverride: repoRoot, projectDir });

      expect(await vcs.isFileIgnoredAsync('secret.txt')).toBe(true);
      expect(await vcs.isFileIgnoredAsync('kept.txt')).toBe(false);
    });

    it('isFileIgnoredAsync prefers the project .easignore when both project and root files exist', async () => {
      await spawnAsync('git', ['init'], { cwd: repoRoot });
      const projectDir = path.join(repoRoot, 'apps', 'app-a');
      await fs.mkdir(projectDir, { recursive: true });
      await fs.writeFile(path.join(repoRoot, '.easignore'), 'from-root.txt\n');
      await fs.writeFile(path.join(projectDir, '.easignore'), 'from-app.txt\n');

      vcs = new NoVcsClient({ cwdOverride: repoRoot, projectDir });

      expect(await vcs.isFileIgnoredAsync('from-app.txt')).toBe(true);
      expect(await vcs.isFileIgnoredAsync('from-root.txt')).toBe(false);
    });
  });
});
