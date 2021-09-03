import { ExpoConfig } from '@expo/config';
import { Platform } from '@expo/eas-build-job';
import { BuildProfile } from '@expo/eas-json';
import fs from 'fs-extra';
import { vol } from 'memfs';
import os from 'os';

import { maybeResolveVersionsAsync } from '../version';

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

describe(maybeResolveVersionsAsync, () => {
  describe('generic project', () => {
    it('reads the version code from native code', async () => {
      const exp = initGenericProject();
      const { appVersion, appBuildVersion } = await maybeResolveVersionsAsync(
        '/repo',
        exp,
        {} as BuildProfile<Platform.ANDROID>
      );
      expect(appVersion).toBe('2.0');
      expect(appBuildVersion).toBe('123');
    });
  });
  describe('managed project', () => {
    it('reads the version code from expo config', async () => {
      const exp = initManagedProject();
      const { appVersion, appBuildVersion } = await maybeResolveVersionsAsync(
        '/repo',
        exp,
        {} as BuildProfile<Platform.ANDROID>
      );
      expect(appVersion).toBe('5.0.0');
      expect(appBuildVersion).toBe('126');
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
    versionName "2.0"
  }
}`,
      './android/app/src/main/AndroidManifest.xml': 'fake',
    },
    '/repo'
  );

  const fakeExp: ExpoConfig = {
    name: 'myproject',
    slug: 'myproject',
    version: '3.0.0',
    android: {
      versionCode: 124,
    },
  };
  return fakeExp;
}

function initManagedProject(): ExpoConfig {
  vol.fromJSON(
    {
      './app.json': JSON.stringify({
        expo: {
          version: '4.0.0',
          android: {
            versionCode: 125,
          },
        },
      }),
    },
    '/repo'
  );

  const fakeExp: ExpoConfig = {
    name: 'myproject',
    slug: 'myproject',
    version: '5.0.0',
    android: {
      versionCode: 126,
    },
  };
  return fakeExp;
}
