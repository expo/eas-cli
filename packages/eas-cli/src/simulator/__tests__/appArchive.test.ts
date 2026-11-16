import { SpawnSyncReturns, spawnSync } from 'child_process';
import { randomBytes } from 'crypto';
import * as fs from 'fs-extra';
import os from 'os';
import path from 'path';

import { createAppArchiveAsync } from '../appArchive';

describe(createAppArchiveAsync, () => {
  let root: string;
  let bundle: string;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'app-archive-test-'));
    bundle = path.join(root, 'Fixture.app');
    const framework = path.join(bundle, 'Frameworks/F.framework');
    await fs.ensureDir(path.join(framework, 'Versions/A'));
    await fs.writeFile(path.join(framework, 'Versions/A/F'), 'framework');
    await fs.symlink('A', path.join(framework, 'Versions/Current'));
    await fs.symlink('Versions/Current/F', path.join(framework, 'F'));
    await fs.link(path.join(framework, 'Versions/A/F'), path.join(bundle, '00-source'));
    await fs.writeFile(path.join(bundle, '01-unrelated'), 'ordinary file');
    for (let i = 0; i < 20; i++) {
      await fs.link(path.join(framework, 'Versions/A/F'), path.join(bundle, `02-hardlink-${i}`));
    }
  });
  afterEach(async () => {
    await fs.remove(root);
  });

  function child(mode: string): SpawnSyncReturns<string> {
    return spawnSync(
      process.execPath,
      [
        '-r',
        require.resolve('ts-node/register/transpile-only'),
        path.join(__dirname, 'fixtures/app-archive.cjs'),
        mode,
        bundle,
      ],
      {
        env: { ...process.env, TMPDIR: root, FORCE_COLOR: '0', NO_COLOR: undefined },
        timeout: 10_000,
        encoding: 'utf8',
      }
    );
  }

  it('finishes packaging hard links beside versioned framework symlinks', () => {
    const result = child('pack');
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  });

  it.each(['interrupt-packaging', 'interrupt-upload'])('cleans its archive on %s', async mode => {
    await fs.writeFile(path.join(bundle, 'asset'), randomBytes(8 * 1024 * 1024));
    const result = child(mode);
    expect(result.error).toBeUndefined();
    expect(result.stdout).toContain(mode);
    expect(result.status).toBe(130);
    expect((await fs.readdir(root)).filter(name => name.startsWith('eas-simulator-app-'))).toEqual(
      []
    );
  });

  it('removes its signal and exit handlers after normal cleanup', async () => {
    const before = [
      process.listeners('SIGINT'),
      process.listeners('SIGTERM'),
      process.listeners('exit'),
    ];
    const archive = await createAppArchiveAsync(bundle);
    await archive.cleanupAsync();
    expect([
      process.listeners('SIGINT'),
      process.listeners('SIGTERM'),
      process.listeners('exit'),
    ]).toEqual(before);
  });
});
