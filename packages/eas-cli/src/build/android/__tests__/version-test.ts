import { ExpoConfig } from '@expo/config';
import fs from 'fs-extra';
import { vol } from 'memfs';
import os from 'os';

import { readVersionCode, readVersionName } from '../version';

jest.mock('fs');

afterAll(() => {
  // do not remove the following line
  // this fixes a weird error with tempy in @expo/image-utils
  fs.removeSync(os.tmpdir());
});

beforeEach(() => {
  vol.reset();
  // do not remove the following line
  // this fixes a weird error with tempy in @expo/image-utils
  fs.mkdirpSync(os.tmpdir());
});

describe(readVersionCode, () => {
  describe('generic project', () => {
    it('reads the version code from native code', () => {
      const exp = initGenericProject();
      const versionCode = readVersionCode('/repo', exp);
      expect(versionCode).toBe(123);
    });
  });
  describe('managed project', () => {
    it('reads the version code from expo config', () => {
      const exp = initManagedProject();
      const versionCode = readVersionCode('/repo', exp);
      expect(versionCode).toBe(123);
    });
  });
});

describe(readVersionName, () => {
  describe('generic project', () => {
    it('reads the version name from native code', () => {
      const exp = initGenericProject();
      const versionName = readVersionName('/repo', exp);
      expect(versionName).toBe('1.0');
    });
  });
  describe('managed project', () => {
    it('reads the version from expo config', () => {
      const exp = initManagedProject();
      const versionName = readVersionName('/repo', exp);
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
