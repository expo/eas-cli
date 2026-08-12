jest.mock('@expo/turtle-spawn');

jest.mock('../../../utils/packageManager', () => ({
  ...jest.requireActual('../../../utils/packageManager'),
  resolvePackageManager: jest.fn(),
}));

jest.mock('../installNodeModules');

import spawn from '@expo/turtle-spawn';

import { createGlobalContextMock } from '../../../__tests__/utils/context';
import { PackageManager, resolvePackageManager } from '../../../utils/packageManager';
import { installNodeModules } from '../installNodeModules';
import { createPrebuildBuildFunction } from '../prebuild';

describe(createPrebuildBuildFunction, () => {
  it('uses production mode for Expo CLI and keeps the install env', async () => {
    jest.mocked(resolvePackageManager).mockReturnValue(PackageManager.NPM);
    const env = { NODE_ENV: 'staging', EXPO_CONFIG_MODE: 'staging', FROM_BUILD: 'true' };
    const globalCtx = createGlobalContextMock({
      staticContextContent: { job: { platform: 'android', experimental: {} } },
    });
    const buildStep = createPrebuildBuildFunction().createBuildStepFromFunctionCall(globalCtx, {
      env,
    });

    await buildStep.executeAsync();

    expect(spawn).toHaveBeenCalledWith(
      'npx',
      ['expo', 'prebuild', '--no-install', '--platform', 'android'],
      expect.objectContaining({
        env: expect.objectContaining({
          NODE_ENV: 'production',
          EXPO_CONFIG_MODE: 'production',
          FROM_BUILD: 'true',
        }),
      })
    );
    expect(installNodeModules).toHaveBeenCalledWith(
      buildStep.ctx,
      expect.objectContaining({
        NODE_ENV: 'staging',
        EXPO_CONFIG_MODE: 'staging',
        FROM_BUILD: 'true',
      })
    );
  });
});
