import { ExpoConfig } from '@expo/config';
import fs from 'fs-extra';
import { vol } from 'memfs';
import os from 'os';

import { readVersionCodeAsync, readVersionNameAsync } from '../version';

jest.mock('fs');

const originalConsoleWarn = console.warn;
beforeAll(() => {
  console.warn = jest.fn();
});
afterAll(() => {
  // do not remove the following line
  // this fixes a weird error with tempy in @expo/image-utils
  fs.removeSync(os.tmpdir());
  console.warn = originalConsoleWarn;
});

beforeEach(() => {
  vol.reset();
  // do not remove the following line
  // this fixes a weird error with tempy in @expo/image-utils
  fs.mkdirpSync(os.tmpdir());
});

describe(readVersionCodeAsync, () => {
  describe('generic project', () => {
    it('reads the version code from native code', async () => {
      const exp = initGenericProject();
      const versionCode = await readVersionCodeAsync('/repo', exp);
      expect(versionCode).toBe(123);
    });
  });
  describe('managed project', () => {
    it('reads the version code from expo config', async () => {
      const exp = initManagedProject();
      const versionCode = await readVersionCodeAsync('/repo', exp);
      expect(versionCode).toBe(123);
    });
  });
});

describe(readVersionNameAsync, () => {
  describe('generic project', () => {
    it('reads the version name from native code', async () => {
      const exp = initGenericProject();
      const versionName = await readVersionNameAsync('/repo', exp);
      expect(versionName).toBe('1.0');
    });
  });
  describe('managed project', () => {
    it('reads the version from expo config', async () => {
      const exp = initManagedProject();
      const versionName = await readVersionNameAsync('/repo', exp);
      expect(versionName).toBe('1.0.0');
    });
  });
});

function initGenericProject(): ExpoConfig {
  vol.fromJSON(
    {
      './app.json': JSON.stringify({
        expo: {
          version: '1.0.0',
          android: {
            versionCode: 1,
          },
        },
      }),
      './android/app/build.gradle': `android {
  defaultConfig {
    applicationId "com.expo.testapp"
    versionCode 123
    versionName "1.0"
  }
}`,
      './android/app/src/main/AndroidManifest.xml': 'fake',
    },
    '/repo'
  );

  const fakeExp: ExpoConfig = {
    name: 'myproject',
    slug: 'myproject',
    version: '1.0.0',
    android: {
      versionCode: 123,
    },
  };
  return fakeExp;
}

function initManagedProject(): ExpoConfig {
  vol.fromJSON(
    {
      './app.json': JSON.stringify({
        expo: {
          version: '1.0.0',
          android: {
            versionCode: 123,
          },
        },
      }),
    },
    '/repo'
  );

  const fakeExp: ExpoConfig = {
    name: 'myproject',
    slug: 'myproject',
    version: '1.0.0',
    android: {
      versionCode: 123,
    },
  };
  return fakeExp;
}
