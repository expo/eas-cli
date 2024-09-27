import { ExpoConfig } from '@expo/config';
import { Platform } from '@expo/eas-build-job';
import { BuildProfile } from '@expo/eas-json';
import assert from 'assert';
import fs from 'fs-extra';
import { vol } from 'memfs';
import os from 'os';
import path from 'path';

import { getAppBuildGradleAsync, resolveConfigValue } from '../../../project/android/gradleUtils';
import { resolveVcsClient } from '../../../vcs';
import {
  BumpStrategy,
  bumpVersionAsync,
  bumpVersionInAppJsonAsync,
  maybeResolveVersionsAsync,
} from '../version';

const fsReal = jest.requireActual('fs').promises as typeof fs;
jest.mock('fs');

const vcsClient = resolveVcsClient();

afterAll(async () => {
  // do not remove the following line
  // this fixes a weird error with tempy in @expo/image-utils
  await fs.remove(os.tmpdir());
});

beforeEach(async () => {
  vol.reset();
  // do not remove the following line
  // this fixes a weird error with tempy in @expo/image-utils
  await fs.mkdirp(os.tmpdir());
});

// bare workflow
describe(bumpVersionAsync, () => {
  it('throws an informative error when multiple flavors are detected in the android project', async () => {
    await initProjectWithGradleFileAsync(
      /*buildGradlePath*/ path.join(
        __dirname,
        '../../../project/android/__tests__/fixtures/multiflavor-build.gradle'
      )
    );
    await expect(
      bumpVersionAsync({
        bumpStrategy: BumpStrategy.VERSION_CODE,
        projectDir: '/multiflavor',
        exp: {} as any,
      })
    ).rejects.toThrow(
      'Automatic version bumping is not supported for multi-flavor Android projects.'
    );
  });
  it('throws an informative error when multiple flavor dimensions are defined in an android project', async () => {
    await initProjectWithGradleFileAsync(
      /*buildGradlePath*/ path.join(
        __dirname,
        '../../../project/android/__tests__/fixtures/multiflavor-with-dimensions-build.gradle'
      )
    );
    await expect(
      bumpVersionAsync({
        bumpStrategy: BumpStrategy.VERSION_CODE,
        projectDir: '/multiflavor',
        exp: {} as any,
      })
    ).rejects.toThrow(
      'Automatic version bumping is not supported for multi-flavor Android projects.'
    );
  });
  it('bumps expo.android.versionCode and buildGradle versionCode when strategy = BumpStrategy.VERSION_CODE', async () => {
    const nativeVersionCode = 100; // this should be overwritten by bumpVersionAsync
    const fakeExp = initBareWorkflowProject({ versionCode: nativeVersionCode });

    await bumpVersionAsync({
      bumpStrategy: BumpStrategy.VERSION_CODE,
      projectDir: '/app',
      exp: fakeExp,
    });

    const appJSON = await fs.readJSON('/app/app.json');
    expect(fakeExp.version).toBe('3.0.0');
    expect(fakeExp.android?.versionCode).toBe(124);
    expect(appJSON.expo.version).toBe('3.0.0');
    expect(appJSON.expo.android.versionCode).toBe(124);

    const buildGradle = await getAppBuildGradleAsync('/app');
    assert(buildGradle);
    expect(resolveConfigValue(buildGradle, 'versionCode')).toBe('124');
    expect(resolveConfigValue(buildGradle, 'versionName')).toBe('3.0.0');
  });

  it('bumps expo.version and gradle versionCode when strategy = BumpStrategy.APP_VERSION', async () => {
    const nativeVersionName = '1.0.0'; // this should be overwritten by bumpVersionAsync
    const fakeExp = initBareWorkflowProject({ versionName: nativeVersionName });

    await bumpVersionAsync({
      bumpStrategy: BumpStrategy.APP_VERSION,
      projectDir: '/app',
      exp: fakeExp,
    });

    const appJSON = await fs.readJSON('/app/app.json');
    expect(fakeExp.version).toBe('3.0.1');
    expect(fakeExp.android?.versionCode).toBe(123);
    expect(appJSON.expo.version).toBe('3.0.1');
    expect(appJSON.expo.android.versionCode).toBe(123);

    const buildGradle = await getAppBuildGradleAsync('/app');
    assert(buildGradle);
    expect(resolveConfigValue(buildGradle, 'versionCode')).toBe('123');
    expect(resolveConfigValue(buildGradle, 'versionName')).toBe('3.0.1');
  });

  it('does not bump any version when strategy = BumpStrategy.NOOP', async () => {
    const fakeExp = initBareWorkflowProject();

    await bumpVersionAsync({
      bumpStrategy: BumpStrategy.NOOP,
      projectDir: '/app',
      exp: fakeExp,
    });

    const appJSON = await fs.readJSON('/app/app.json');
    expect(fakeExp.version).toBe('3.0.0');
    expect(fakeExp.android?.versionCode).toBe(123);
    expect(appJSON.expo.version).toBe('3.0.0');
    expect(appJSON.expo.android.versionCode).toBe(123);

    const buildGradle = await getAppBuildGradleAsync('/app');
    assert(buildGradle);
    expect(resolveConfigValue(buildGradle, 'versionCode')).toBe('123');
    expect(resolveConfigValue(buildGradle, 'versionName')).toBe('3.0.0');
  });
});

// managed workflow
describe(bumpVersionInAppJsonAsync, () => {
  it('bumps expo.android.versionCode when strategy = BumpStrategy.VERSION_CODE', async () => {
    const fakeExp = initManagedProject();

    await bumpVersionInAppJsonAsync({
      bumpStrategy: BumpStrategy.VERSION_CODE,
      projectDir: '/app',
      exp: fakeExp,
    });

    const appJSON = await fs.readJSON('/app/app.json');
    expect(fakeExp.version).toBe('5.0.0');
    expect(fakeExp.android?.versionCode).toBe(127);
    expect(appJSON.expo.version).toBe('5.0.0');
    expect(appJSON.expo.android.versionCode).toBe(127);
  });

  it('bumps expo.version when strategy = BumpStrategy.SHORT_VERSION', async () => {
    const fakeExp = initManagedProject();

    await bumpVersionInAppJsonAsync({
      bumpStrategy: BumpStrategy.APP_VERSION,
      projectDir: '/app',
      exp: fakeExp,
    });

    const appJSON = await fs.readJSON('/app/app.json');
    expect(fakeExp.version).toBe('5.0.1');
    expect(fakeExp.android?.versionCode).toBe(126);
    expect(appJSON.expo.version).toBe('5.0.1');
    expect(appJSON.expo.android.versionCode).toBe(126);
  });

  it('does not bump any version when strategy = BumpStrategy.NOOP', async () => {
    const fakeExp = initManagedProject();

    await bumpVersionInAppJsonAsync({
      bumpStrategy: BumpStrategy.NOOP,
      projectDir: '/app',
      exp: fakeExp,
    });

    const appJSON = await fs.readJSON('/app/app.json');
    expect(fakeExp.version).toBe('5.0.0');
    expect(fakeExp.android?.versionCode).toBe(126);
    expect(appJSON.expo.version).toBe('5.0.0');
    expect(appJSON.expo.android.versionCode).toBe(126);
  });
});

describe(maybeResolveVersionsAsync, () => {
  describe('bare project', () => {
    it('reads the versions from native code', async () => {
      const exp = initBareWorkflowProject();
      const { appVersion, appBuildVersion } = await maybeResolveVersionsAsync(
        '/app',
        exp,
        {} as BuildProfile<Platform.ANDROID>,
        vcsClient
      );
      expect(appVersion).toBe('3.0.0');
      expect(appBuildVersion).toBe('123');
    });
  });
  describe('managed project', () => {
    it('reads the versions from expo config', async () => {
      const exp = initManagedProject();
      const { appVersion, appBuildVersion } = await maybeResolveVersionsAsync(
        '/app',
        exp,
        {} as BuildProfile<Platform.ANDROID>,
        vcsClient
      );
      expect(appVersion).toBe('5.0.0');
      expect(appBuildVersion).toBe('126');
    });
  });
});

function initBareWorkflowProject({
  versionCode = 123,
  versionName = '3.0.0',
}: {
  versionCode?: number;
  versionName?: string;
} = {}): ExpoConfig {
  const fakeExp: ExpoConfig = {
    name: 'myproject',
    slug: 'myproject',
    version: '3.0.0',
    android: {
      versionCode: 123,
    },
  };
  vol.fromJSON(
    {
      './app.json': JSON.stringify({
        expo: fakeExp,
      }),
      './android/app/build.gradle': `android {
  defaultConfig {
    applicationId "com.expo.testapp"
    versionCode ${versionCode}
    versionName "${versionName}"
  }
}`,
      './android/app/src/main/AndroidManifest.xml': 'fake',
    },
    '/app'
  );

  return fakeExp;
}

function initManagedProject(): ExpoConfig {
  const fakeExp: ExpoConfig = {
    name: 'myproject',
    slug: 'myproject',
    version: '5.0.0',
    android: {
      versionCode: 126,
    },
  };
  vol.fromJSON(
    {
      './app.json': JSON.stringify({
        expo: fakeExp,
      }),
    },
    '/app'
  );

  return fakeExp;
}

async function initProjectWithGradleFileAsync(gradleFilePath: string): Promise<void> {
  vol.fromJSON(
    {
      'android/app/build.gradle': await fsReal.readFile(gradleFilePath, 'utf-8'),
      './app.json': JSON.stringify({
        expo: {} as any,
      }),
    },
    '/multiflavor'
  );
}
