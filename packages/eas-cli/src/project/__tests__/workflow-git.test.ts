import spawnAsync from '@expo/spawn-async';
import { Platform, Workflow } from '@expo/eas-build-job';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import GitClient from '../../vcs/clients/git';
import { resolveWorkflowAsync } from '../workflow';

describe('resolveWorkflowAsync with GitClient', () => {
  let repoRoot: string;

  beforeEach(async () => {
    repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-cli-workflow-test-'));
    await spawnAsync('git', ['init'], { cwd: repoRoot });
    await spawnAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: repoRoot });
    await spawnAsync('git', ['config', 'user.name', 'Test User'], { cwd: repoRoot });
  });

  afterEach(async () => {
    await fs.rm(repoRoot, { recursive: true, force: true });
  });

  it('treats tracked gitignored native projects as managed when requireCommit is false', async () => {
    const vcsClient = new GitClient({
      requireCommit: false,
      maybeCwdOverride: repoRoot,
    });

    await fs.mkdir(path.join(repoRoot, 'ios', 'app.xcodeproj'), { recursive: true });
    await fs.writeFile(path.join(repoRoot, 'ios', 'app.xcodeproj', 'project.pbxproj'), 'fake');
    await fs.writeFile(path.join(repoRoot, '.gitignore'), 'ios/\n');

    await spawnAsync('git', ['add', '.'], { cwd: repoRoot });
    await spawnAsync('git', ['commit', '-m', 'test setup'], { cwd: repoRoot });

    await expect(resolveWorkflowAsync(repoRoot, Platform.IOS, vcsClient)).resolves.toBe(
      Workflow.MANAGED
    );
  });

  it('treats tracked gitignored native projects as generic when requireCommit is true', async () => {
    const vcsClient = new GitClient({
      requireCommit: true,
      maybeCwdOverride: repoRoot,
    });

    await fs.mkdir(path.join(repoRoot, 'ios', 'app.xcodeproj'), { recursive: true });
    await fs.writeFile(path.join(repoRoot, 'ios', 'app.xcodeproj', 'project.pbxproj'), 'fake');
    await fs.writeFile(path.join(repoRoot, '.gitignore'), 'ios/\n');

    await spawnAsync('git', ['add', '.'], { cwd: repoRoot });
    await spawnAsync('git', ['commit', '-m', 'test setup'], { cwd: repoRoot });

    await expect(resolveWorkflowAsync(repoRoot, Platform.IOS, vcsClient)).resolves.toBe(
      Workflow.GENERIC
    );
  });
});
