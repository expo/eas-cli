import { ExpoConfig } from '@expo/config';
import { vol } from 'memfs';

import { readVersionCode } from '../version';

beforeEach(() => {
  vol.reset();
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
