import { errors } from '@expo/eas-build-job';
import spawn from '@expo/turtle-spawn';
import { vol } from 'memfs';
import path from 'path';

import { getExpoPackageVersionAsync } from '../service';

jest.mock('fs');
jest.mock('@expo/turtle-spawn', () => jest.fn());

describe(getExpoPackageVersionAsync, () => {
  const projectRoot = '/test-project';
  const expoPackageJsonPath = path.join(projectRoot, 'node_modules/expo/package.json');
  const buildContext = {
    env: { PATH: '/usr/bin' },
    getReactNativeProjectDirectory: () => projectRoot,
  } as any;

  beforeEach(() => {
    vol.reset();
    jest.clearAllMocks();
  });

  it('returns the exact installed expo package version', async () => {
    jest.mocked(spawn).mockResolvedValue({ stdout: Buffer.from(expoPackageJsonPath) } as any);
    vol.fromJSON({
      [expoPackageJsonPath]: JSON.stringify({ version: '55.0.17' }),
    });

    await expect(getExpoPackageVersionAsync(buildContext)).resolves.toBe('55.0.17');
    expect(spawn).toHaveBeenCalledWith(
      'node',
      ['--print', "require.resolve('expo/package.json')"],
      expect.objectContaining({
        cwd: projectRoot,
        env: buildContext.env,
      })
    );
  });

  it('throws a user error when expo package version resolution fails', async () => {
    jest.mocked(spawn).mockRejectedValue(new Error('Cannot find module expo/package.json'));

    await expect(getExpoPackageVersionAsync(buildContext)).rejects.toMatchObject({
      errorCode: 'EAS_BUILD_EXPO_PACKAGE_VERSION_NOT_FOUND',
    });
    await expect(getExpoPackageVersionAsync(buildContext)).rejects.toBeInstanceOf(errors.UserError);
  });

  it('throws a user error when the installed expo package version is not valid semver', async () => {
    jest.mocked(spawn).mockResolvedValue({ stdout: Buffer.from(expoPackageJsonPath) } as any);
    vol.fromJSON({
      [expoPackageJsonPath]: JSON.stringify({ version: 'invalid-version' }),
    });

    await expect(getExpoPackageVersionAsync(buildContext)).rejects.toMatchObject({
      errorCode: 'EAS_BUILD_EXPO_PACKAGE_VERSION_INVALID',
    });
    await expect(getExpoPackageVersionAsync(buildContext)).rejects.toBeInstanceOf(errors.UserError);
  });
});
