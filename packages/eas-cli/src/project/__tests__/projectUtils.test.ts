import { AppJSONConfig, PackageJSONConfig } from '@expo/config';
import { vol } from 'memfs';
import path from 'path';
import resolveFrom from 'resolve-from';

import { enforceRollBackToEmbeddedUpdateSupportAsync } from '../projectUtils';

jest.mock('fs');
jest.mock('resolve-from');

const projectRoot = '/test-project';

describe(enforceRollBackToEmbeddedUpdateSupportAsync, () => {
  it('does not throw when an appropriate version is installed', async () => {
    mockTestProject('0.19.1');

    await enforceRollBackToEmbeddedUpdateSupportAsync(projectRoot);
  });

  it('throws when an unappropriate version is installed', async () => {
    mockTestProject('0.18.0');

    await expect(enforceRollBackToEmbeddedUpdateSupportAsync(projectRoot)).rejects.toThrowError(
      'The expo-updates package must have a version >= 0.19.0 to use roll back to embedded, which corresponds to Expo SDK 50 or greater.'
    );
  });
});

function mockTestProject(expoUpdatesPackageVersion: string): { appJson: AppJSONConfig } {
  const packageJSON: PackageJSONConfig = {
    name: 'testing123',
    version: '0.1.0',
    description: 'fake description',
    main: 'index.js',
    dependencies: {
      'expo-updates': expoUpdatesPackageVersion,
    },
  };

  const expoUpdatesPackageJSON: PackageJSONConfig = {
    name: 'expo-updates',
    version: expoUpdatesPackageVersion,
  };

  const appJSON: AppJSONConfig = {
    expo: {
      name: 'testing 123',
      version: '0.1.0',
      slug: 'testing-123',
      sdkVersion: '33.0.0',
    },
  };

  jest
    .mocked(resolveFrom.silent)
    .mockReturnValue(path.join(projectRoot, 'node_modules/expo-updates/package.json'));

  vol.fromJSON(
    {
      'package.json': JSON.stringify(packageJSON),
      'app.json': JSON.stringify(appJSON),
      'node_modules/expo-updates/package.json': JSON.stringify(expoUpdatesPackageJSON),
    },
    projectRoot
  );

  return { appJson: appJSON };
}
