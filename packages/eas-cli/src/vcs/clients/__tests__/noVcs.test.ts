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

    it('should return the current working directory when not in Git repository', async () => {
      expect(await vcs.getRootPathAsync()).toBe(process.cwd());
    });

    it('should return the Git root when in Git repository', async () => {
      await spawnAsync('git', ['init'], { cwd: repoRoot });
      expect(await fs.realpath(await vcs.getRootPathAsync())).toBe(await fs.realpath(repoRoot));
    });

    it('should return the project root when EAS_PROJECT_ROOT is set', async () => {
      process.env.EAS_PROJECT_ROOT = 'project-root';
      expect(await vcs.getRootPathAsync()).toBe(path.resolve(process.cwd(), 'project-root'));

      process.env.EAS_PROJECT_ROOT = '/app';
      expect(await vcs.getRootPathAsync()).toBe('/app');
    });
  });
});
