import { Platform } from '@expo/eas-build-job';
import fs from 'fs-extra';
import { vol } from 'memfs';

import { EasJsonReader } from '../reader';

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
  const iosProfile = await reader.getBuildProfileAsync(Platform.IOS, 'production');
  const androidProfile = await reader.getBuildProfileAsync(Platform.ANDROID, 'production');

  expect(androidProfile).toEqual({
    distribution: 'store',
    credentialsSource: 'remote',
  });

  expect(iosProfile).toEqual({
    distribution: 'store',
    credentialsSource: 'remote',
  });
});

test('valid eas.json for development client builds', async () => {
  await fs.writeJson('/project/eas.json', {
    build: {
      production: {},
      debug: {
        developmentClient: true,
        android: {
          withoutCredentials: true,
        },
      },
    },
  });

  const reader = new EasJsonReader('/project');
  const iosProfile = await reader.getBuildProfileAsync(Platform.IOS, 'debug');
  const androidProfile = await reader.getBuildProfileAsync(Platform.ANDROID, 'debug');
  expect(androidProfile).toEqual({
    credentialsSource: 'remote',
    distribution: 'store',
    developmentClient: true,
    withoutCredentials: true,
  });

  expect(iosProfile).toEqual({
    credentialsSource: 'remote',
    distribution: 'store',
    developmentClient: true,
  });
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
  const profile = await reader.getBuildProfileAsync(Platform.ANDROID, 'internal');
  expect(profile).toEqual({
    distribution: 'internal',
    credentialsSource: 'remote',
  });
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
  const baseProfile = await reader.getBuildProfileAsync(Platform.ANDROID, 'base');
  const extendedProfile = await reader.getBuildProfileAsync(Platform.ANDROID, 'extension');
  expect(baseProfile).toEqual({
    distribution: 'store',
    credentialsSource: 'remote',
    node: '12.0.0',
  });
  expect(extendedProfile).toEqual({
    distribution: 'internal',
    credentialsSource: 'remote',
    node: '13.0.0',
  });
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
  const baseProfile = await reader.getBuildProfileAsync(Platform.ANDROID, 'base');
  const extendedAndroidProfile = await reader.getBuildProfileAsync(Platform.ANDROID, 'extension');
  const extendedIosProfile = await reader.getBuildProfileAsync(Platform.IOS, 'extension');
  expect(baseProfile).toEqual({
    distribution: 'store',
    credentialsSource: 'remote',
    env: {
      BASE_ENV: '1',
      PROFILE: 'base',
    },
  });
  expect(extendedAndroidProfile).toEqual({
    distribution: 'internal',
    credentialsSource: 'remote',
    env: {
      BASE_ENV: '1',
      PROFILE: 'extension:android',
    },
  });
  expect(extendedIosProfile).toEqual({
    distribution: 'internal',
    credentialsSource: 'remote',
    env: {
      BASE_ENV: '1',
      PROFILE: 'extension',
    },
  });
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
  const baseProfile = await reader.getBuildProfileAsync(Platform.ANDROID, 'base');
  const extendedAndroidProfile = await reader.getBuildProfileAsync(Platform.ANDROID, 'extension');
  const extendedIosProfile = await reader.getBuildProfileAsync(Platform.IOS, 'extension');
  expect(baseProfile).toEqual({
    distribution: 'store',
    credentialsSource: 'remote',
    cache: {
      disabled: true,
    },
  });
  expect(extendedAndroidProfile).toEqual({
    distribution: 'internal',
    credentialsSource: 'remote',
    cache: {
      cacheDefaultPaths: false,
      customPaths: ['somefakepath'],
    },
  });
  expect(extendedIosProfile).toEqual({
    distribution: 'internal',
    credentialsSource: 'remote',

    cache: {
      key: 'extend-key',
    },
  });
});

test('valid eas.json with missing profile', async () => {
  await fs.writeJson('/project/eas.json', {
    build: {
      production: {},
    },
  });

  const reader = new EasJsonReader('/project');
  const promise = reader.getBuildProfileAsync(Platform.ANDROID, 'debug');
  await expect(promise).rejects.toThrowError('Missing build profile in eas.json: debug');
});

test('invalid eas.json when using wrong buildType', async () => {
  await fs.writeJson('/project/eas.json', {
    build: {
      production: { android: { buildType: 'archive' } },
    },
  });

  const reader = new EasJsonReader('/project');
  const promise = reader.getBuildProfileAsync(Platform.ANDROID, 'production');
  await expect(promise).rejects.toThrowError(
    'eas.json is not valid [ValidationError: "build.production.android.buildType" must be one of [apk, app-bundle]]'
  );
});

test('empty json', async () => {
  await fs.writeJson('/project/eas.json', {});

  const reader = new EasJsonReader('/project');
  const promise = reader.getBuildProfileAsync(Platform.ANDROID, 'production');
  await expect(promise).rejects.toThrowError('Missing build profile in eas.json: production');
});

test('invalid semver value', async () => {
  await fs.writeJson('/project/eas.json', {
    build: {
      production: { node: 'alpha' },
    },
  });

  const reader = new EasJsonReader('/project');
  const promise = reader.getBuildProfileAsync(Platform.ANDROID, 'production');
  await expect(promise).rejects.toThrowError(
    'eas.json is not valid [ValidationError: "build.production.node" failed custom validation because alpha is not a valid version]'
  );
});

test('invalid release channel', async () => {
  await fs.writeJson('/project/eas.json', {
    build: {
      production: { releaseChannel: 'feature/myfeature' },
    },
  });

  const reader = new EasJsonReader('/project');
  const promise = reader.getBuildProfileAsync(Platform.ANDROID, 'production');
  await expect(promise).rejects.toThrowError(/fails to match the required pattern/);
});

test('get profile names', async () => {
  await fs.writeJson('/project/eas.json', {
    build: {
      production: { node: '12.0.0-alpha' },
      blah: { node: '12.0.0' },
    },
  });

  const reader = new EasJsonReader('/project');
  const allProfileNames = await reader.getBuildProfileNamesAsync();
  expect(allProfileNames.sort()).toEqual(['blah', 'production'].sort());
});
