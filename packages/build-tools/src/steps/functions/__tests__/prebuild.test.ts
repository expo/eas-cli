jest.mock('../../../utils/packageManager', () => ({
  ...jest.requireActual('../../../utils/packageManager'),
  resolvePackageManager: jest.fn(),
}));

jest.mock('../../../utils/project', () => ({
  runExpoCliCommand: jest.fn(),
}));

jest.mock('../installNodeModules');

import { createGlobalContextMock } from '../../../__tests__/utils/context';
import { PackageManager, resolvePackageManager } from '../../../utils/packageManager';
import { runExpoCliCommand } from '../../../utils/project';
import { installNodeModules } from '../installNodeModules';
import { createPrebuildBuildFunction } from '../prebuild';

describe(createPrebuildBuildFunction, () => {
  it('uses production mode for Expo CLI and keeps the original env for dependency installation', async () => {
    jest.mocked(resolvePackageManager).mockReturnValue(PackageManager.NPM);
    const env = { NODE_ENV: 'staging', __EXPO_CONFIG_MODE: 'staging', FROM_BUILD: 'true' };
    const globalCtx = createGlobalContextMock({
      staticContextContent: { job: { platform: 'android', experimental: {} } },
    });
    const buildStep = createPrebuildBuildFunction().createBuildStepFromFunctionCall(globalCtx, {
      env,
    });

    await buildStep.executeAsync();

    expect(runExpoCliCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        packageManager: PackageManager.NPM,
        args: ['prebuild', '--no-install', '--platform', 'android'],
        options: expect.objectContaining({
          env: expect.objectContaining({
            NODE_ENV: 'staging',
            __EXPO_CONFIG_MODE: 'staging',
            FROM_BUILD: 'true',
          }),
        }),
        envMode: 'production',
      })
    );
    expect(installNodeModules).toHaveBeenCalledWith(
      buildStep.ctx,
      expect.objectContaining({
        NODE_ENV: 'staging',
        __EXPO_CONFIG_MODE: 'staging',
        FROM_BUILD: 'true',
      })
    );
  });
});
