import fs from 'fs-extra';
import os from 'os';
import path from 'path';

import { shouldUseVersionedExpoCLIExpensive } from '../expoCli';

describe('resolving @expo/cli with a strict (pnpm-style) node_modules layout', () => {
  let root: string;

  beforeEach(async () => {
    delete process.env.EXPO_USE_LOCAL_CLI;
    root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'eas-expo-cli-')));
  });

  afterEach(async () => {
    await fs.remove(root);
  });

  it('finds @expo/cli installed next to expo, outside the project node_modules', async () => {
    // <root>/store/node_modules/{expo,@expo/cli} mimics node_modules/.pnpm/expo@x/node_modules
    const store = path.join(root, 'store', 'node_modules');
    await fs.outputJson(path.join(store, 'expo', 'package.json'), { name: 'expo' });
    await fs.outputJson(path.join(store, '@expo', 'cli', 'package.json'), {
      name: '@expo/cli',
      main: 'index.js',
    });
    await fs.outputFile(path.join(store, '@expo', 'cli', 'index.js'), '');
    const projectDir = path.join(root, 'project');
    await fs.ensureDir(path.join(projectDir, 'node_modules'));
    await fs.symlink(path.join(store, 'expo'), path.join(projectDir, 'node_modules', 'expo'));

    expect(shouldUseVersionedExpoCLIExpensive(projectDir, { sdkVersion: '54.0.0' })).toBe(true);
  });

  it('returns false when neither the project nor expo can reach @expo/cli', async () => {
    const projectDir = path.join(root, 'project');
    await fs.outputJson(path.join(projectDir, 'node_modules', 'expo', 'package.json'), {
      name: 'expo',
    });

    expect(shouldUseVersionedExpoCLIExpensive(projectDir, { sdkVersion: '54.0.0' })).toBe(false);
  });
});
