jest.mock('../installDependencies', () => ({
  installDependenciesWithNpmCacheFallbackAsync: jest.fn(),
  resolvePackagerDir: jest.fn(() => '/app'),
}));

jest.mock('../../utils/project', () => ({
  runExpoCliCommand: jest.fn(),
}));

import { PackageManager } from '../../utils/packageManager';
import { runExpoCliCommand } from '../../utils/project';
import { createMockLogger } from '../../__tests__/utils/logger';
import { installDependenciesWithNpmCacheFallbackAsync } from '../installDependencies';
import { prebuildAsync } from '../prebuild';

describe(prebuildAsync, () => {
  it('uses production mode for Expo CLI and keeps the install env', async () => {
    const env = { NODE_ENV: 'staging', EXPO_CONFIG_MODE: 'staging', FROM_BUILD: 'true' };
    const ctx = {
      env,
      job: { platform: 'android', experimental: {} },
      packageManager: PackageManager.NPM,
    } as any;
    const logger = createMockLogger();

    await prebuildAsync(ctx, { logger, workingDir: '/app' });

    expect(runExpoCliCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        args: ['prebuild', '--no-install', '--platform', 'android'],
        options: expect.objectContaining({
          env: expect.objectContaining({
            NODE_ENV: 'production',
            EXPO_CONFIG_MODE: 'production',
            FROM_BUILD: 'true',
          }),
        }),
      })
    );
    expect(installDependenciesWithNpmCacheFallbackAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        env: { NODE_ENV: 'staging', EXPO_CONFIG_MODE: 'staging', FROM_BUILD: 'true' },
      })
    );
  });
});
