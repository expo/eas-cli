import { Platform } from '@expo/eas-build-job';
import fs from 'fs-extra';
import { vol } from 'memfs';

import { EasJsonReader } from '../EasJsonReader';

jest.mock('fs');

beforeEach(async () => {
  vol.reset();
  await fs.mkdirp('/project');
});

test('minimal valid eas.json for both platforms', async () => {
  await fs.writeJson('/project/eas.json', {
    build: {
      production: {},
    },
  });

  const reader = new EasJsonReader('/project');
  const iosProfile = await reader.readBuildProfileAsync(Platform.IOS, 'production');
  const androidProfile = await reader.readBuildProfileAsync(Platform.ANDROID, 'production');

  expect({
    distribution: 'store',
    credentialsSource: 'remote',
  }).toEqual(androidProfile);

  expect({
    distribution: 'store',
    credentialsSource: 'remote',
  }).toEqual(iosProfile);
});

test('valid eas.json for development client builds', async () => {
  await fs.writeJson('/project/eas.json', {
    build: {
      production: {},
      debug: {
        useDevelopmentClient: true,
        android: {
          withoutCredentials: true,
        },
      },
    },
  });

  const reader = new EasJsonReader('/project');
  const iosProfile = await reader.readBuildProfileAsync(Platform.IOS, 'debug');
  const androidProfile = await reader.readBuildProfileAsync(Platform.ANDROID, 'debug');
  expect({
    credentialsSource: 'remote',
    distribution: 'store',
    useDevelopmentClient: true,
    withoutCredentials: true,
  }).toEqual(androidProfile);

  expect({
    credentialsSource: 'remote',
    distribution: 'store',
    useDevelopmentClient: true,
  }).toEqual(iosProfile);
});

test('valid profile for internal distribution on Android', async () => {
  await fs.writeJson('/project/eas.json', {
    build: {
      internal: {
        distribution: 'internal',
      },
    },
  });

  const reader = new EasJsonReader('/project');
  const profile = await reader.readBuildProfileAsync(Platform.ANDROID, 'internal');
  expect({
    distribution: 'internal',
    credentialsSource: 'remote',
  }).toEqual(profile);
});

test('valid profile extending other profile', async () => {
  await fs.writeJson('/project/eas.json', {
    build: {
      base: {
        node: '12.0.0',
      },
      extension: {
        extends: 'base',
        distribution: 'internal',
        node: '13.0.0',
      },
    },
  });

  const reader = new EasJsonReader('/project');
  const baseProfile = await reader.readBuildProfileAsync(Platform.ANDROID, 'base');
  const extendedProfile = await reader.readBuildProfileAsync(Platform.ANDROID, 'extension');
  expect({
    distribution: 'store',
    credentialsSource: 'remote',
    node: '12.0.0',
  }).toEqual(baseProfile);
  expect({
    distribution: 'internal',
    credentialsSource: 'remote',
    node: '13.0.0',
  }).toEqual(extendedProfile);
});

test('valid profile extending other profile with platform specific envs', async () => {
  await fs.writeJson('/project/eas.json', {
    build: {
      base: {
        env: {
          BASE_ENV: '1',
          PROFILE: 'base',
        },
      },
      extension: {
        extends: 'base',
        distribution: 'internal',
        env: {
          PROFILE: 'extension',
        },
        android: {
          env: {
            PROFILE: 'extension:android',
          },
        },
      },
    },
  });

  const reader = new EasJsonReader('/project');
  const baseProfile = await reader.readBuildProfileAsync(Platform.ANDROID, 'base');
  const extendedAndroidProfile = await reader.readBuildProfileAsync(Platform.ANDROID, 'extension');
  const extendedIosProfile = await reader.readBuildProfileAsync(Platform.IOS, 'extension');
  expect({
    distribution: 'store',
    credentialsSource: 'remote',
    env: {
      BASE_ENV: '1',
      PROFILE: 'base',
    },
  }).toEqual(baseProfile);
  expect({
    distribution: 'internal',
    credentialsSource: 'remote',
    env: {
      BASE_ENV: '1',
      PROFILE: 'extension:android',
    },
  }).toEqual(extendedAndroidProfile);
  expect({
    distribution: 'internal',
    credentialsSource: 'remote',
    env: {
      BASE_ENV: '1',
      PROFILE: 'extension',
    },
  }).toEqual(extendedIosProfile);
});

test('valid profile extending other profile with platform specific caching', async () => {
  await fs.writeJson('/project/eas.json', {
    build: {
      base: {
        cache: {
          disabled: true,
        },
      },
      extension: {
        extends: 'base',
        distribution: 'internal',
        cache: {
          key: 'extend-key',
        },
        android: {
          cache: {
            cacheDefaultPaths: false,
            customPaths: ['somefakepath'],
          },
        },
      },
    },
  });

  const reader = new EasJsonReader('/project');
  const baseProfile = await reader.readBuildProfileAsync(Platform.ANDROID, 'base');
  const extendedAndroidProfile = await reader.readBuildProfileAsync(Platform.ANDROID, 'extension');
  const extendedIosProfile = await reader.readBuildProfileAsync(Platform.IOS, 'extension');
  expect({
    distribution: 'store',
    credentialsSource: 'remote',
    cache: {
      disabled: true,
    },
  }).toEqual(baseProfile);
  expect({
    distribution: 'internal',
    credentialsSource: 'remote',
    cache: {
      cacheDefaultPaths: false,
      customPaths: ['somefakepath'],
    },
  }).toEqual(extendedAndroidProfile);
  expect({
    distribution: 'internal',
    credentialsSource: 'remote',

    cache: {
      key: 'extend-key',
    },
  }).toEqual(extendedIosProfile);
});

test('valid eas.json with missing profile', async () => {
  await fs.writeJson('/project/eas.json', {
    build: {
      production: {},
    },
  });

  const reader = new EasJsonReader('/project');
  const promise = reader.readBuildProfileAsync(Platform.ANDROID, 'debug');
  await expect(promise).rejects.toThrowError('There is no profile named debug in eas.json');
});

test('invalid eas.json when using wrong buildType', async () => {
  await fs.writeJson('/project/eas.json', {
    build: {
      production: { android: { buildType: 'archive' } },
    },
  });

  const reader = new EasJsonReader('/project');
  const promise = reader.readBuildProfileAsync(Platform.ANDROID, 'production');
  await expect(promise).rejects.toThrowError(
    'eas.json is not valid [ValidationError: "build.production.android.buildType" must be one of [apk, app-bundle]]'
  );
});

test('empty json', async () => {
  await fs.writeJson('/project/eas.json', {});

  const reader = new EasJsonReader('/project');
  const promise = reader.readBuildProfileAsync(Platform.ANDROID, 'production');
  await expect(promise).rejects.toThrowError('There is no profile named production in eas.json');
});

test('invalid semver value', async () => {
  await fs.writeJson('/project/eas.json', {
    build: {
      production: { node: '12.0.0-alpha' },
    },
  });

  const reader = new EasJsonReader('/project');
  const promise = reader.readBuildProfileAsync(Platform.ANDROID, 'production');
  await expect(promise).rejects.toThrowError(
    'eas.json is not valid [ValidationError: "build.production.node" failed custom validation because 12.0.0-alpha is not a valid version]'
  );
});

test('get profile names', async () => {
  await fs.writeJson('/project/eas.json', {
    build: {
      production: { node: '12.0.0-alpha' },
      blah: { node: '12.0.0-alpha' },
    },
  });

  const reader = new EasJsonReader('/project');
  const allProfileNames = await reader.getBuildProfileNamesAsync();
  expect(allProfileNames.sort()).toEqual(['blah', 'production'].sort());
});
