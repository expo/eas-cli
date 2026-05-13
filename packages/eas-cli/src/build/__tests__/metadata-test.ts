import fs from 'fs-extra';
import os from 'os';
import path from 'path';

import { maybeGetExpoPackageVersionAsync, truncateGitCommitMessage } from '../metadata';

describe(truncateGitCommitMessage, () => {
  it('returns undefined if no message was passed', () => {
    expect(truncateGitCommitMessage(undefined)).toBeUndefined();
  });
  it('returns commit message', () => {
    expect(truncateGitCommitMessage('a'.repeat(10))).toBe('a'.repeat(10));
  });

  it('truncates long commit messages', () => {
    expect(truncateGitCommitMessage('a'.repeat(5000))).toBe(`${'a'.repeat(4093)}...`);
  });
});

describe(maybeGetExpoPackageVersionAsync, () => {
  it('returns the installed expo package version', async () => {
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-cli-metadata-test-'));
    try {
      await fs.outputJson(path.join(projectDir, 'node_modules/expo/package.json'), {
        version: '55.0.17',
      });

      await expect(maybeGetExpoPackageVersionAsync(projectDir)).resolves.toBe('55.0.17');
    } finally {
      await fs.remove(projectDir);
    }
  });

  it('returns undefined when expo is not installed', async () => {
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-cli-metadata-test-'));
    try {
      await expect(maybeGetExpoPackageVersionAsync(projectDir)).resolves.toBeUndefined();
    } finally {
      await fs.remove(projectDir);
    }
  });
});
