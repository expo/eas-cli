import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

describe('build:list on an unlinked project', () => {
  it.each([true, false])('returns the project error with JSON mode %s', json => {
    const configLog = 'Loading the unlinked fixture project';
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eas-build-list-'));
    try {
      fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({ name: 'app' }));
      fs.writeFileSync(
        path.join(projectDir, 'app.config.js'),
        `console.log(${JSON.stringify(configLog)}); module.exports = { name: 'app', slug: 'app', sdkVersion: '56.0.0' };`
      );
      // A fresh update-check cache keeps oclif from spawning a registry request in the fixture.
      fs.writeFileSync(path.join(projectDir, 'version'), '{}');
      const result = spawnSync(
        process.execPath,
        [
          '--require',
          require.resolve('../../../../jest/unlinkedProject.cjs'),
          path.resolve(__dirname, '../../../../bin/dev'),
          'build:list',
          '--non-interactive',
          ...(json ? ['--json'] : []),
        ],
        {
          cwd: projectDir,
          env: {
            PATH: process.env.PATH,
            HOME: projectDir,
            USERPROFILE: projectDir,
            EXPO_TOKEN: 'fixture-token',
            EAS_NO_VCS: '1',
            EAS_PROJECT_ROOT: projectDir,
            EAS_CACHE_DIR: projectDir,
            EXPO_LOCAL: '1',
            EXPO_NO_TELEMETRY: '1',
            CI: '1',
            NO_COLOR: '1',
          },
          timeout: 60000,
          encoding: 'utf8',
        }
      );
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('eas init --id');
      if (json) {
        expect(result.stderr).toContain(configLog);
        expect(JSON.parse(result.stdout)).toStrictEqual({
          error: {
            code: 'EAS_PROJECT_NOT_CONFIGURED',
            accountsWithProjectCreationPermission: ['creator'],
          },
        });
      } else {
        expect(result.stdout).toContain(configLog);
        expect(result.stdout).not.toContain('EAS_PROJECT_NOT_CONFIGURED');
      }
    } finally {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  });
});
