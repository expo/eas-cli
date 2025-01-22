import { Platform } from '@expo/eas-build-job';
import chalk from 'chalk';
import fs from 'fs-extra';
import { vol } from 'memfs';

import { EasJsonAccessor } from '../accessor';
import { InvalidEasJsonError } from '../errors';
import { EasJsonUtils } from '../utils';

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

  const accessor = EasJsonAccessor.fromProjectPath('/project');
  const iosProfile = await EasJsonUtils.getBuildProfileAsync(accessor, Platform.IOS, 'production');
  const androidProfile = await EasJsonUtils.getBuildProfileAsync(
    accessor,
    Platform.ANDROID,
    'production'
  );

  expect(androidProfile).toEqual({
    distribution: 'store',
    credentialsSource: 'remote',
  });

  expect(iosProfile).toEqual({
    distribution: 'store',
    credentialsSource: 'remote',
  });
});

test('minimal valid eas.json for both platforms when reading eas.json from string', async () => {
  const accessor = EasJsonAccessor.fromRawString(
    JSON.stringify({
      build: {
        production: {},
      },
    })
  );
  const iosProfile = await EasJsonUtils.getBuildProfileAsync(accessor, Platform.IOS, 'production');
  const androidProfile = await EasJsonUtils.getBuildProfileAsync(
    accessor,
    Platform.ANDROID,
    'production'
  );

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

  const accessor = EasJsonAccessor.fromProjectPath('/project');
  const iosProfile = await EasJsonUtils.getBuildProfileAsync(accessor, Platform.IOS, 'debug');
  const androidProfile = await EasJsonUtils.getBuildProfileAsync(
    accessor,
    Platform.ANDROID,
    'debug'
  );
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

test('valid eas.json with specified environment', async () => {
  await fs.writeJson('/project/eas.json', {
    build: {
      development: {
        environment: 'production',
      },
    },
  });

  const accessor = EasJsonAccessor.fromProjectPath('/project');
  const iosProfile = await EasJsonUtils.getBuildProfileAsync(accessor, Platform.IOS, 'development');
  const androidProfile = await EasJsonUtils.getBuildProfileAsync(
    accessor,
    Platform.ANDROID,
    'development'
  );
  expect(androidProfile).toEqual({
    credentialsSource: 'remote',
    distribution: 'store',
    environment: 'production',
  });

  expect(iosProfile).toEqual({
    credentialsSource: 'remote',
    distribution: 'store',
    environment: 'production',
  });
});

test('valid eas.json with specified keystoreName', async () => {
  const keystoreName = 'this-is-a-keystore-name';
  await fs.writeJson('/project/eas.json', {
    build: {
      development: {
        android: {
          credentialsSource: 'remote',
          keystoreName,
        },
      },
    },
  });

  const accessor = EasJsonAccessor.fromProjectPath('/project');
  const androidProfile = await EasJsonUtils.getBuildProfileAsync(
    accessor,
    Platform.ANDROID,
    'development'
  );

  expect(androidProfile).toEqual(
    expect.objectContaining({
      keystoreName,
    })
  );
});

test('valid eas.json with top level withoutCredentials property', async () => {
  await fs.writeJson('/project/eas.json', {
    build: {
      production: {},
      debug: {
        developmentClient: true,
        withoutCredentials: true,
      },
    },
  });

  const accessor = EasJsonAccessor.fromProjectPath('/project');
  const iosProfile = await EasJsonUtils.getBuildProfileAsync(accessor, Platform.IOS, 'debug');
  const androidProfile = await EasJsonUtils.getBuildProfileAsync(
    accessor,
    Platform.ANDROID,
    'debug'
  );
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
    withoutCredentials: true,
  });
});

test('valid eas.json with iOS withoutCredentials property', async () => {
  await fs.writeJson('/project/eas.json', {
    build: {
      production: {},
      debug: {
        developmentClient: true,
        ios: { withoutCredentials: true },
      },
    },
  });

  const accessor = EasJsonAccessor.fromProjectPath('/project');
  const iosProfile = await EasJsonUtils.getBuildProfileAsync(accessor, Platform.IOS, 'debug');
  const androidProfile = await EasJsonUtils.getBuildProfileAsync(
    accessor,
    Platform.ANDROID,
    'debug'
  );
  expect(androidProfile).toEqual({
    credentialsSource: 'remote',
    distribution: 'store',
    developmentClient: true,
  });

  expect(iosProfile).toEqual({
    credentialsSource: 'remote',
    distribution: 'store',
    developmentClient: true,
    withoutCredentials: true,
  });
});

test('valid eas.json with top level and platform-sepcific withoutCredentials property', async () => {
  await fs.writeJson('/project/eas.json', {
    build: {
      production: {},
      debug: {
        developmentClient: true,
        withoutCredentials: true,
        ios: { withoutCredentials: false },
      },
    },
  });

  const accessor = EasJsonAccessor.fromProjectPath('/project');
  const iosProfile = await EasJsonUtils.getBuildProfileAsync(accessor, Platform.IOS, 'debug');
  const androidProfile = await EasJsonUtils.getBuildProfileAsync(
    accessor,
    Platform.ANDROID,
    'debug'
  );
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
    withoutCredentials: false,
  });
});

test(`valid eas.json with autoIncrement flag at build profile root`, async () => {
  await fs.writeJson('/project/eas.json', {
    build: {
      production: {
        autoIncrement: true,
      },
    },
  });

  const accessor = EasJsonAccessor.fromProjectPath('/project');
  const iosProfile = await EasJsonUtils.getBuildProfileAsync(accessor, Platform.IOS, 'production');
  const androidProfile = await EasJsonUtils.getBuildProfileAsync(
    accessor,
    Platform.ANDROID,
    'production'
  );
  expect(androidProfile).toEqual({
    autoIncrement: true,
    credentialsSource: 'remote',
    distribution: 'store',
  });

  expect(iosProfile).toEqual({
    autoIncrement: true,
    credentialsSource: 'remote',
    distribution: 'store',
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

  const accessor = EasJsonAccessor.fromProjectPath('/project');
  const profile = await EasJsonUtils.getBuildProfileAsync(accessor, Platform.ANDROID, 'internal');
  expect(profile).toEqual({
    distribution: 'internal',
    credentialsSource: 'remote',
  });
});

test('valid profile with extension chain not exceeding 5', async () => {
  await fs.writeJson('/project/eas.json', {
    build: {
      base: {
        node: '12.0.0',
      },
      extension1: {
        extends: 'base',
        distribution: 'internal',
        node: '13.0.0',
      },
      extension2: {
        extends: 'extension1',
        distribution: 'internal',
        node: '14.0.0',
      },
      extension3: {
        extends: 'extension2',
        distribution: 'internal',
        node: '15.0.0',
      },
      extension4: {
        extends: 'extension3',
        distribution: 'internal',
        node: '16.0.0',
      },
    },
  });

  const accessor = EasJsonAccessor.fromProjectPath('/project');
  const baseProfile = await EasJsonUtils.getBuildProfileAsync(accessor, Platform.ANDROID, 'base');
  const extendedProfile1 = await EasJsonUtils.getBuildProfileAsync(
    accessor,
    Platform.ANDROID,
    'extension1'
  );
  const extendedProfile2 = await EasJsonUtils.getBuildProfileAsync(
    accessor,
    Platform.ANDROID,
    'extension2'
  );
  const extendedProfile3 = await EasJsonUtils.getBuildProfileAsync(
    accessor,
    Platform.ANDROID,
    'extension3'
  );
  const extendedProfile4 = await EasJsonUtils.getBuildProfileAsync(
    accessor,
    Platform.ANDROID,
    'extension4'
  );
  expect(baseProfile).toEqual({
    distribution: 'store',
    credentialsSource: 'remote',
    node: '12.0.0',
  });
  expect(extendedProfile1).toEqual({
    distribution: 'internal',
    credentialsSource: 'remote',
    node: '13.0.0',
  });
  expect(extendedProfile2).toEqual({
    distribution: 'internal',
    credentialsSource: 'remote',
    node: '14.0.0',
  });
  expect(extendedProfile3).toEqual({
    distribution: 'internal',
    credentialsSource: 'remote',
    node: '15.0.0',
  });
  expect(extendedProfile4).toEqual({
    distribution: 'internal',
    credentialsSource: 'remote',
    node: '16.0.0',
  });
});

test('valid profile with extension chain exceeding 5 - too long', async () => {
  await fs.writeJson('/project/eas.json', {
    build: {
      base: {
        node: '12.0.0',
      },
      extension1: {
        extends: 'base',
        distribution: 'internal',
        node: '13.0.0',
      },
      extension2: {
        extends: 'extension1',
        distribution: 'internal',
        node: '14.0.0',
      },
      extension3: {
        extends: 'extension2',
        distribution: 'internal',
        node: '15.0.0',
      },
      extension4: {
        extends: 'extension3',
        distribution: 'internal',
        node: '16.0.0',
      },
      extension5: {
        extends: 'extension4',
        distribution: 'internal',
        node: '17.0.0',
      },
    },
  });

  const accessor = EasJsonAccessor.fromProjectPath('/project');
  await expect(
    EasJsonUtils.getBuildProfileAsync(accessor, Platform.ANDROID, 'extension5')
  ).rejects.toThrow(
    'Too long chain of profile extensions, make sure "extends" keys do not make a cycle'
  );
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

  const accessor = EasJsonAccessor.fromProjectPath('/project');
  const baseProfile = await EasJsonUtils.getBuildProfileAsync(accessor, Platform.ANDROID, 'base');
  const extendedAndroidProfile = await EasJsonUtils.getBuildProfileAsync(
    accessor,
    Platform.ANDROID,
    'extension'
  );
  const extendedIosProfile = await EasJsonUtils.getBuildProfileAsync(
    accessor,
    Platform.IOS,
    'extension'
  );
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
            paths: ['somefakepath'],
          },
        },
      },
    },
  });

  const accessor = EasJsonAccessor.fromProjectPath('/project');
  const baseProfile = await EasJsonUtils.getBuildProfileAsync(accessor, Platform.ANDROID, 'base');
  const extendedAndroidProfile = await EasJsonUtils.getBuildProfileAsync(
    accessor,
    Platform.ANDROID,
    'extension'
  );
  const extendedIosProfile = await EasJsonUtils.getBuildProfileAsync(
    accessor,
    Platform.IOS,
    'extension'
  );
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
      paths: ['somefakepath'],
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

test('valid profile extending other profile with platform specific caching - backwards compatible with customPaths', async () => {
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
            customPaths: ['somefakepath'],
          },
        },
      },
    },
  });

  const accessor = EasJsonAccessor.fromProjectPath('/project');
  const baseProfile = await EasJsonUtils.getBuildProfileAsync(accessor, Platform.ANDROID, 'base');
  const extendedAndroidProfile = await EasJsonUtils.getBuildProfileAsync(
    accessor,
    Platform.ANDROID,
    'extension'
  );
  const extendedIosProfile = await EasJsonUtils.getBuildProfileAsync(
    accessor,
    Platform.IOS,
    'extension'
  );
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
      paths: ['somefakepath'],
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

  const accessor = EasJsonAccessor.fromProjectPath('/project');
  const promise = EasJsonUtils.getBuildProfileAsync(accessor, Platform.ANDROID, 'debug');
  await expect(promise).rejects.toThrowError('Missing build profile in eas.json: debug');
});

test('invalid eas.json when using wrong buildType', async () => {
  await fs.writeJson('/project/eas.json', {
    build: {
      production: { android: { buildType: 'archive' } },
    },
  });

  const accessor = EasJsonAccessor.fromProjectPath('/project');
  const promise = EasJsonUtils.getBuildProfileAsync(accessor, Platform.ANDROID, 'production');
  await expect(promise).rejects.toThrowError(InvalidEasJsonError);
  await expect(promise).rejects.toThrowError(
    /.*eas\.json.* is not valid\.\r?\n- "build.production.android.buildType" must be one of \[apk, app-bundle\]$/g
  );
});

test('empty json', async () => {
  await fs.writeJson('/project/eas.json', {});

  const accessor = EasJsonAccessor.fromProjectPath('/project');
  const promise = EasJsonUtils.getBuildProfileAsync(accessor, Platform.ANDROID, 'production');
  await expect(promise).rejects.toThrowError('Missing build profile in eas.json: production');
});

test('invalid semver value', async () => {
  await fs.writeJson('/project/eas.json', {
    build: {
      production: { node: 'alpha' },
    },
  });

  const accessor = EasJsonAccessor.fromProjectPath('/project');
  const promise = EasJsonUtils.getBuildProfileAsync(accessor, Platform.ANDROID, 'production');
  await expect(promise).rejects.toThrowError(InvalidEasJsonError);
  await expect(promise).rejects.toThrowError(
    /.*eas\.json.* is not valid\.\r?\n- "build.production.node" failed custom validation because alpha is not a valid version$/g
  );
});

test('get profile names', async () => {
  await fs.writeJson('/project/eas.json', {
    build: {
      production: { node: '12.0.0-alpha' },
      blah: { node: '12.0.0' },
    },
  });

  const accessor = EasJsonAccessor.fromProjectPath('/project');
  const allProfileNames = await EasJsonUtils.getBuildProfileNamesAsync(accessor);
  expect(allProfileNames.sort()).toEqual(['blah', 'production'].sort());
});

test('invalid resourceClass at build profile root', async () => {
  await fs.writeJson('/project/eas.json', {
    build: {
      production: {
        resourceClass: 'm1-experimental',
      },
    },
  });

  const accessor = EasJsonAccessor.fromProjectPath('/project');

  await expect(
    EasJsonUtils.getBuildProfileAsync(accessor, Platform.IOS, 'production')
  ).rejects.toThrowError(/build.production.resourceClass.*must be one of/);
});

test('iOS-specific resourceClass', async () => {
  await fs.writeJson('/project/eas.json', {
    build: {
      production: {
        ios: {
          resourceClass: 'm1-medium',
        },
      },
    },
  });

  const accessor = EasJsonAccessor.fromProjectPath('/project');
  await expect(
    EasJsonUtils.getBuildProfileAsync(accessor, Platform.IOS, 'production')
  ).resolves.not.toThrow();
});

test('iOS-specific `large` resourceClass', async () => {
  await fs.writeJson('/project/eas.json', {
    build: {
      production: {
        ios: {
          resourceClass: 'large',
        },
      },
    },
  });

  const accessor = EasJsonAccessor.fromProjectPath('/project');
  await expect(
    EasJsonUtils.getBuildProfileAsync(accessor, Platform.IOS, 'production')
  ).resolves.not.toThrow();
});

test('`large` resourceClass in build profile root', async () => {
  await fs.writeJson('/project/eas.json', {
    build: {
      production: {
        resourceClass: 'large',
      },
    },
  });

  const accessor = EasJsonAccessor.fromProjectPath('/project');
  await expect(
    EasJsonUtils.getBuildProfileAsync(accessor, Platform.IOS, 'production')
  ).resolves.not.toThrow();
});

test('Android-specific resourceClass', async () => {
  await fs.writeJson('/project/eas.json', {
    build: {
      production: {
        android: {
          resourceClass: 'large',
        },
      },
    },
  });

  const accessor = EasJsonAccessor.fromProjectPath('/project');
  await expect(
    EasJsonUtils.getBuildProfileAsync(accessor, Platform.ANDROID, 'production')
  ).resolves.not.toThrow();
});

test('build profile with platform-specific custom build config', async () => {
  await fs.writeJson('/project/eas.json', {
    build: {
      production: {
        android: {
          config: 'production.android.yml',
        },
        ios: {
          config: 'production.ios.yml',
        },
      },
    },
  });

  const accessor = EasJsonAccessor.fromProjectPath('/project');
  const androidProfile = await EasJsonUtils.getBuildProfileAsync(
    accessor,
    Platform.ANDROID,
    'production'
  );
  const iosProfile = await EasJsonUtils.getBuildProfileAsync(accessor, Platform.IOS, 'production');
  expect(androidProfile).toEqual({
    config: 'production.android.yml',
    distribution: 'store',
    credentialsSource: 'remote',
  });
  expect(iosProfile).toEqual({
    config: 'production.ios.yml',
    distribution: 'store',
    credentialsSource: 'remote',
  });
});

test('build profiles with both platform build config', async () => {
  await fs.writeJson('/project/eas.json', {
    build: {
      production: {
        config: 'production.yml',
      },
    },
  });

  const accessor = EasJsonAccessor.fromProjectPath('/project');
  const androidProfile = await EasJsonUtils.getBuildProfileAsync(
    accessor,
    Platform.ANDROID,
    'production'
  );
  const iosProfile = await EasJsonUtils.getBuildProfileAsync(accessor, Platform.IOS, 'production');
  expect(androidProfile).toEqual({
    config: 'production.yml',
    distribution: 'store',
    credentialsSource: 'remote',
  });
  expect(iosProfile).toEqual({
    config: 'production.yml',
    distribution: 'store',
    credentialsSource: 'remote',
  });
});

test('valid build profile with caching without paths', async () => {
  await fs.writeJson('/project/eas.json', {
    build: {
      production: {
        cache: {
          disabled: false,
        },
      },
    },
  });

  const accessor = EasJsonAccessor.fromProjectPath('/project');
  const iosProfile = await EasJsonUtils.getBuildProfileAsync(accessor, Platform.IOS, 'production');
  const androidProfile = await EasJsonUtils.getBuildProfileAsync(
    accessor,
    Platform.ANDROID,
    'production'
  );

  expect(androidProfile).toEqual({
    distribution: 'store',
    credentialsSource: 'remote',
    cache: {
      disabled: false,
    },
  });

  expect(iosProfile).toEqual({
    distribution: 'store',
    credentialsSource: 'remote',
    cache: {
      disabled: false,
    },
  });
});

test('valid build profile with caching with paths', async () => {
  await fs.writeJson('/project/eas.json', {
    build: {
      production: {
        cache: {
          disabled: false,
          paths: ['index.ts'],
        },
      },
    },
  });

  const accessor = EasJsonAccessor.fromProjectPath('/project');
  const iosProfile = await EasJsonUtils.getBuildProfileAsync(accessor, Platform.IOS, 'production');
  const androidProfile = await EasJsonUtils.getBuildProfileAsync(
    accessor,
    Platform.ANDROID,
    'production'
  );

  expect(androidProfile).toEqual({
    distribution: 'store',
    credentialsSource: 'remote',
    cache: {
      disabled: false,
      paths: ['index.ts'],
    },
  });

  expect(iosProfile).toEqual({
    distribution: 'store',
    credentialsSource: 'remote',
    cache: {
      disabled: false,
      paths: ['index.ts'],
    },
  });
});

test('valid build profile with caching with customPaths - moved into paths and customPaths removed', async () => {
  await fs.writeJson('/project/eas.json', {
    build: {
      production: {
        cache: {
          disabled: false,
          customPaths: ['index.ts'],
        },
      },
    },
  });

  const accessor = EasJsonAccessor.fromProjectPath('/project');
  const iosProfile = await EasJsonUtils.getBuildProfileAsync(accessor, Platform.IOS, 'production');
  const androidProfile = await EasJsonUtils.getBuildProfileAsync(
    accessor,
    Platform.ANDROID,
    'production'
  );

  expect(androidProfile).toEqual({
    distribution: 'store',
    credentialsSource: 'remote',
    cache: {
      disabled: false,
      paths: ['index.ts'],
    },
  });

  expect(iosProfile).toEqual({
    distribution: 'store',
    credentialsSource: 'remote',
    cache: {
      disabled: false,
      paths: ['index.ts'],
    },
  });
});

test('invalid build profile with caching with both paths and customPaths - error thrown', async () => {
  await fs.writeJson('/project/eas.json', {
    build: {
      production: {
        cache: {
          disabled: false,
          customPaths: ['index.ts'],
          paths: ['index2.ts'],
        },
      },
    },
  });
  const expectedError = new InvalidEasJsonError(
    `${chalk.bold(
      'eas.json'
    )} is not valid.\n- Cannot provide both "cache.customPaths" and "cache.paths" - use "cache.paths"`
  );
  const accessor = EasJsonAccessor.fromProjectPath('/project');

  await expect(async () => {
    await EasJsonUtils.getBuildProfileAsync(accessor, Platform.IOS, 'production');
  }).rejects.toThrow(expectedError);

  await expect(async () => {
    await EasJsonUtils.getBuildProfileAsync(accessor, Platform.ANDROID, 'production');
  }).rejects.toThrow(expectedError);
});
