import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

describe('fingerprint:compare --json', () => {
  it.each([
    { code: 'EAS_LOGIN_REQUIRED', token: undefined, args: ['--build-id', 'build-id'] },
    { code: 'EAS_PERMISSION_DENIED', token: 'denied-token', args: ['--build-id', 'build-id'] },
    { code: 'EAS_INPUT_REQUIRED', token: 'allowed-token', args: [] },
    { code: 'EAS_INPUT_REQUIRED', token: 'allowed-token', args: ['--update-id', 'group-id'] },
  ])('returns $code for $args', ({ code, token, args }) => {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eas-fingerprint-'));
    try {
      fs.writeFileSync(path.join(projectDir, 'package.json'), '{"name":"fixture"}');
      fs.writeFileSync(
        path.join(projectDir, 'app.json'),
        JSON.stringify({
          expo: {
            name: 'fixture',
            slug: 'fixture',
            sdkVersion: '56.0.0',
            extra: { eas: { projectId: '00000000-0000-4000-8000-000000000001' } },
          },
        })
      );
      // The update check reads this cache before deciding whether to spawn a registry lookup.
      fs.writeFileSync(path.join(projectDir, 'version'), '{}');
      const result = spawnSync(
        process.execPath,
        [
          '--require',
          require.resolve('../../../../jest/fingerprintProject.cjs'),
          path.resolve(__dirname, '../../../../bin/dev'),
          'fingerprint:compare',
          ...args,
          '--json',
        ],
        {
          cwd: projectDir,
          env: {
            PATH: process.env.PATH,
            HOME: projectDir,
            USERPROFILE: projectDir,
            EAS_CACHE_DIR: projectDir,
            EAS_PROJECT_ROOT: projectDir,
            EAS_NO_VCS: '1',
            EXPO_LOCAL: '1',
            EXPO_NO_TELEMETRY: '1',
            EXPO_TOKEN: token,
            CI: '1',
            NO_COLOR: '1',
          },
          timeout: 60000,
          encoding: 'utf8',
        }
      );
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(JSON.parse(result.stdout)).toMatchObject({
        error: { code, message: expect.any(String) },
      });
    } finally {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  });
});
