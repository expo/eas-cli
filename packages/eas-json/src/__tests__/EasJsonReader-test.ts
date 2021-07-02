import fs from 'fs-extra';
import { vol } from 'memfs';

import { EasJsonReader } from '../EasJsonReader';

jest.mock('fs');

beforeEach(async () => {
  vol.reset();
  await fs.mkdirp('/project');
});

test('minimal valid android eas.json', async () => {
  await fs.writeJson('/project/eas.json', {
    builds: {
      android: {
        release: {},
      },
    },
  });

  const reader = new EasJsonReader('/project', 'android');
  const easJson = await reader.readAsync('release');
  expect({
    builds: {
      android: {
        distribution: 'store',
        credentialsSource: 'remote',
        env: {},
        withoutCredentials: false,
        cache: { disabled: false, cacheDefaultPaths: true, customPaths: [] },
        image: 'default',
      },
    },
  }).toEqual(easJson);
});

test('minimal valid ios eas.json', async () => {
  await fs.writeJson('/project/eas.json', {
    builds: {
      ios: {
        release: {},
      },
    },
  });

  const reader = new EasJsonReader('/project', 'ios');
  const easJson = await reader.readAsync('release');
  expect({
    builds: {
      ios: {
        credentialsSource: 'remote',
        distribution: 'store',
        autoIncrement: false,
        env: {},
        cache: { disabled: false, cacheDefaultPaths: true, customPaths: [] },
      },
    },
  }).toEqual(easJson);
});

test('minimal valid eas.json for both platforms', async () => {
  await fs.writeJson('/project/eas.json', {
    builds: {
      android: {
        release: {},
      },
      ios: {
        release: {},
      },
    },
  });

  const reader = new EasJsonReader('/project', 'all');
  const easJson = await reader.readAsync('release');
  expect({
    builds: {
      android: {
        distribution: 'store',
        credentialsSource: 'remote',
        env: {},
        withoutCredentials: false,
        cache: { disabled: false, cacheDefaultPaths: true, customPaths: [] },
        image: 'default',
      },
      ios: {
        distribution: 'store',
        credentialsSource: 'remote',
        autoIncrement: false,
        env: {},
        cache: { disabled: false, cacheDefaultPaths: true, customPaths: [] },
      },
    },
  }).toEqual(easJson);
});

test('valid eas.json with both platform, but reading only android', async () => {
  await fs.writeJson('/project/eas.json', {
    builds: {
      ios: {
        release: {},
      },
      android: {
        release: {},
      },
    },
  });

  const reader = new EasJsonReader('/project', 'android');
  const easJson = await reader.readAsync('release');
  expect({
    builds: {
      android: {
        distribution: 'store',
        credentialsSource: 'remote',
        env: {},
        withoutCredentials: false,
        cache: { disabled: false, cacheDefaultPaths: true, customPaths: [] },
        image: 'default',
      },
    },
  }).toEqual(easJson);
});

test('valid eas.json for development client builds', async () => {
  await fs.writeJson('/project/eas.json', {
    builds: {
      ios: {
        release: {},
        debug: { buildType: 'development-client' },
      },
      android: {
        release: {},
        debug: {
          withoutCredentials: false,
          buildType: 'development-client',
        },
      },
    },
  });

  const reader = new EasJsonReader('/project', 'all');
  const easJson = await reader.readAsync('debug');
  expect({
    builds: {
      android: {
        credentialsSource: 'remote',
        distribution: 'store',
        env: {},
        image: 'default',
        withoutCredentials: false,
        cache: { disabled: false, cacheDefaultPaths: true, customPaths: [] },
        buildType: 'development-client',
      },
      ios: {
        credentialsSource: 'remote',
        distribution: 'store',
        autoIncrement: false,
        env: {},
        cache: { disabled: false, cacheDefaultPaths: true, customPaths: [] },
        buildType: 'development-client',
      },
    },
  }).toEqual(easJson);
});

test('valid generic profile for internal distribution on Android', async () => {
  await fs.writeJson('/project/eas.json', {
    builds: {
      android: {
        internal: {
          distribution: 'internal',
        },
      },
    },
  });

  const reader = new EasJsonReader('/project', 'android');
  const easJson = await reader.readAsync('internal');
  expect({
    builds: {
      android: {
        distribution: 'internal',
        credentialsSource: 'remote',
        env: {},
        withoutCredentials: false,
        cache: { disabled: false, cacheDefaultPaths: true, customPaths: [] },
        image: 'default',
      },
    },
  }).toEqual(easJson);
});

test('valid managed profile for internal distribution on Android', async () => {
  await fs.writeJson('/project/eas.json', {
    builds: {
      android: {
        internal: {
          distribution: 'internal',
        },
      },
    },
  });

  const reader = new EasJsonReader('/project', 'android');
  const easJson = await reader.readAsync('internal');
  expect({
    builds: {
      android: {
        distribution: 'internal',
        credentialsSource: 'remote',
        withoutCredentials: false,
        env: {},
        cache: { disabled: false, cacheDefaultPaths: true, customPaths: [] },
        image: 'default',
      },
    },
  }).toEqual(easJson);
});

test('invalid managed profile for internal distribution on Android', async () => {
  await fs.writeJson('/project/eas.json', {
    builds: {
      android: {
        internal: {
          buildType: 'aab',
          distribution: 'internal',
        },
      },
    },
  });

  const reader = new EasJsonReader('/project', 'android');
  const promise = reader.readAsync('internal');
  await expect(promise).rejects.toThrowError(
    'Object "android.internal" in eas.json is not valid [ValidationError: "buildType" must be one of [apk, development-client]]'
  );
});

test('invalid eas.json with missing preset', async () => {
  await fs.writeJson('/project/eas.json', {
    builds: {
      android: {
        release: {},
      },
    },
  });

  const reader = new EasJsonReader('/project', 'android');
  const promise = reader.readAsync('debug');
  await expect(promise).rejects.toThrowError(
    'There is no profile named debug for platform android'
  );
});

test('invalid eas.json when using buildType for wrong platform', async () => {
  await fs.writeJson('/project/eas.json', {
    builds: {
      android: {
        release: { buildType: 'archive' },
      },
    },
  });

  const reader = new EasJsonReader('/project', 'android');
  const promise = reader.readAsync('release');
  await expect(promise).rejects.toThrowError(
    'Object "android.release" in eas.json is not valid [ValidationError: "buildType" must be one of [apk, app-bundle, development-client]]'
  );
});

test('empty json', async () => {
  await fs.writeJson('/project/eas.json', {});

  const reader = new EasJsonReader('/project', 'android');
  const promise = reader.readAsync('release');
  await expect(promise).rejects.toThrowError(
    'There is no profile named release for platform android'
  );
});

test('invalid semver value', async () => {
  await fs.writeJson('/project/eas.json', {
    builds: {
      android: {
        release: { node: '12.0.0-alpha' },
      },
    },
  });

  const reader = new EasJsonReader('/project', 'android');
  const promise = reader.readAsync('release');
  await expect(promise).rejects.toThrowError(
    'Object "android.release" in eas.json is not valid [ValidationError: "node" failed custom validation because 12.0.0-alpha is not a valid version]'
  );
});

test('get profile names', async () => {
  await fs.writeJson('/project/eas.json', {
    builds: {
      android: {
        release: { node: '12.0.0-alpha' },
        blah: { node: '12.0.0-alpha' },
      },
      ios: {
        test: { node: '12.0.0-alpha' },
        blah: { node: '12.0.0-alpha' },
      },
    },
  });

  const androidReader = new EasJsonReader('/project', 'android');
  const androidProfileNames = await androidReader.getBuildProfileNamesAsync();
  expect(androidProfileNames.sort()).toEqual(['release', 'blah'].sort());

  const iosReader = new EasJsonReader('/project', 'ios');
  const iosProfileNames = await iosReader.getBuildProfileNamesAsync();
  expect(iosProfileNames.sort()).toEqual(['test', 'blah'].sort());

  const allReader = new EasJsonReader('/project', 'all');
  const allProfileNames = await allReader.getBuildProfileNamesAsync();
  expect(allProfileNames.sort()).toEqual(['blah'].sort());
});
