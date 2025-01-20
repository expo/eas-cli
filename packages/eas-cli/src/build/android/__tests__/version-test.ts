import { ExpoConfig } from '@expo/config';
import { Platform } from '@expo/eas-build-job';
import { BuildProfile } from '@expo/eas-json';
import { AndroidBuildProfile } from '@expo/eas-json/build/build/types';
import assert from 'assert';
import fs from 'fs-extra';
import { vol } from 'memfs';
import os from 'os';
import path from 'path';
import { instance, mock } from 'ts-mockito';

import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { AppVersionMutation } from '../../../graphql/mutations/AppVersionMutation';
import { AppVersionQuery } from '../../../graphql/queries/AppVersionQuery';
import { getAppBuildGradleAsync, resolveConfigValue } from '../../../project/android/gradleUtils';
import { resolveVcsClient } from '../../../vcs';
import { Client } from '../../../vcs/vcs';
import {
  BumpStrategy,
  bumpVersionAsync,
  bumpVersionInAppJsonAsync,
  maybeResolveVersionsAsync,
  resolveRemoteVersionCodeAsync,
} from '../version';

const fsReal = jest.requireActual('fs').promises as typeof fs;
jest.mock('fs');
jest.mock('../../../commandUtils/context/contextUtils/createGraphqlClient');
jest.mock('../../../vcs/vcs');
jest.mock('../../../graphql/queries/AppVersionQuery');
jest.mock('../../../graphql/mutations/AppVersionMutation');
jest.mock('../../../ora', () => ({
  ora: jest.fn().mockImplementation(() => ({
    start: jest.fn().mockImplementation(() => ({
      succeed: jest.fn(),
      stop: jest.fn(),
      fail: jest.fn(),
    })),
  })),
}));

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

describe(resolveRemoteVersionCodeAsync, () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses current remote versionCode when remote version set, autoIncrement=false', async () => {
    const graphQLClientMock = instance(mock<ExpoGraphqlClient>());
    const vcsClientMock = instance(mock<Client>());
    vcsClientMock.getRootPathAsync = async () => '/app';
    jest.mocked(AppVersionQuery.latestVersionAsync).mockResolvedValue({
      buildVersion: '11',
      storeVersion: '1.2.3',
    });
    const createAppVersionAsyncSpy = jest.spyOn(AppVersionMutation, 'createAppVersionAsync');
    const exp = initBareWorkflowProject();

    const result = await resolveRemoteVersionCodeAsync(graphQLClientMock, {
      projectDir: '/app',
      projectId: 'fakeProjectId',
      exp,
      applicationId: 'fakeApplicationId',
      buildProfile: {} as AndroidBuildProfile,
      vcsClient: vcsClientMock,
    });

    expect(result).toBe('11');
    expect(createAppVersionAsyncSpy).not.toHaveBeenCalled();
  });

  it('initializes versionCode from local files when remote version not set, autoIncrement=false', async () => {
    const graphQLClientMock = instance(mock<ExpoGraphqlClient>());
    const vcsClientMock = instance(mock<Client>());
    vcsClientMock.getRootPathAsync = async () => '/app';
    jest.mocked(AppVersionQuery.latestVersionAsync).mockResolvedValue(null);
    const createAppVersionAsyncSpy = jest.spyOn(AppVersionMutation, 'createAppVersionAsync');
    const exp = initBareWorkflowProject({ versionCode: 22, versionName: '2.3.4' });

    const result = await resolveRemoteVersionCodeAsync(graphQLClientMock, {
      projectDir: '/app',
      projectId: 'fakeProjectId',
      exp,
      applicationId: 'fakeApplicationId',
      buildProfile: {} as AndroidBuildProfile,
      vcsClient: vcsClientMock,
    });

    expect(result).toBe('22');
    expect(createAppVersionAsyncSpy).toHaveBeenCalled();
    expect(createAppVersionAsyncSpy.mock.calls[0][1].storeVersion).toBe('2.3.4');
    expect(createAppVersionAsyncSpy.mock.calls[0][1].buildVersion).toBe('22');
  });

  it('initializes versionCode starting with 1 when remote version not set and not set in local files, autoIncrement=false', async () => {
    const graphQLClientMock = instance(mock<ExpoGraphqlClient>());
    const vcsClientMock = instance(mock<Client>());
    vcsClientMock.getRootPathAsync = async () => '/app';
    jest.mocked(AppVersionQuery.latestVersionAsync).mockResolvedValue(null);
    const createAppVersionAsyncSpy = jest.spyOn(AppVersionMutation, 'createAppVersionAsync');
    const exp = initBareWorkflowProject({ versionCode: null, versionName: null });

    const result = await resolveRemoteVersionCodeAsync(graphQLClientMock, {
      projectDir: '/app',
      projectId: 'fakeProjectId',
      exp,
      applicationId: 'fakeApplicationId',
      buildProfile: {} as AndroidBuildProfile,
      vcsClient: vcsClientMock,
    });

    expect(result).toBe('1');
    expect(createAppVersionAsyncSpy).toHaveBeenCalled();
    expect(createAppVersionAsyncSpy.mock.calls[0][1].storeVersion).toBe('1.0.0');
    expect(createAppVersionAsyncSpy.mock.calls[0][1].buildVersion).toBe('1');
  });

  it('increments current remote versionCode when remote version set, autoIncrement=true', async () => {
    const graphQLClientMock = instance(mock<ExpoGraphqlClient>());
    const vcsClientMock = instance(mock<Client>());
    vcsClientMock.getRootPathAsync = async () => '/app';
    jest.mocked(AppVersionQuery.latestVersionAsync).mockResolvedValue({
      buildVersion: '11',
      storeVersion: '1.2.3',
    });
    const createAppVersionAsyncSpy = jest.spyOn(AppVersionMutation, 'createAppVersionAsync');
    const exp = initBareWorkflowProject();

    const result = await resolveRemoteVersionCodeAsync(graphQLClientMock, {
      projectDir: '/app',
      projectId: 'fakeProjectId',
      exp,
      applicationId: 'fakeApplicationId',
      buildProfile: { autoIncrement: true } as AndroidBuildProfile,
      vcsClient: vcsClientMock,
    });

    expect(result).toBe('12');
    expect(createAppVersionAsyncSpy).toHaveBeenCalled();
    expect(createAppVersionAsyncSpy.mock.calls[0][1].storeVersion).toBe('3.0.0');
    expect(createAppVersionAsyncSpy.mock.calls[0][1].buildVersion).toBe('12');
  });

  it('increments versionCode from local files when remote version not set, autoIncrement=true', async () => {
    const graphQLClientMock = instance(mock<ExpoGraphqlClient>());
    const vcsClientMock = instance(mock<Client>());
    vcsClientMock.getRootPathAsync = async () => '/app';
    jest.mocked(AppVersionQuery.latestVersionAsync).mockResolvedValue(null);
    const createAppVersionAsyncSpy = jest.spyOn(AppVersionMutation, 'createAppVersionAsync');
    const exp = initBareWorkflowProject({ versionCode: 22, versionName: '2.3.4' });

    const result = await resolveRemoteVersionCodeAsync(graphQLClientMock, {
      projectDir: '/app',
      projectId: 'fakeProjectId',
      exp,
      applicationId: 'fakeApplicationId',
      buildProfile: { autoIncrement: true } as AndroidBuildProfile,
      vcsClient: vcsClientMock,
    });

    expect(result).toBe('23');
    expect(createAppVersionAsyncSpy).toHaveBeenCalled();
    expect(createAppVersionAsyncSpy.mock.calls[0][1].storeVersion).toBe('2.3.4');
    expect(createAppVersionAsyncSpy.mock.calls[0][1].buildVersion).toBe('23');
  });

  it('initializes versionCode starting with 1 when remote version not set and not set in local files, autoIncrement=true', async () => {
    const graphQLClientMock = instance(mock<ExpoGraphqlClient>());
    const vcsClientMock = instance(mock<Client>());
    vcsClientMock.getRootPathAsync = async () => '/app';
    jest.mocked(AppVersionQuery.latestVersionAsync).mockResolvedValue(null);
    const createAppVersionAsyncSpy = jest.spyOn(AppVersionMutation, 'createAppVersionAsync');
    const exp = initBareWorkflowProject({ versionCode: null, versionName: null });

    const result = await resolveRemoteVersionCodeAsync(graphQLClientMock, {
      projectDir: '/app',
      projectId: 'fakeProjectId',
      exp,
      applicationId: 'fakeApplicationId',
      buildProfile: { autoIncrement: true } as AndroidBuildProfile,
      vcsClient: vcsClientMock,
    });

    expect(result).toBe('1');
    expect(createAppVersionAsyncSpy).toHaveBeenCalled();
    expect(createAppVersionAsyncSpy.mock.calls[0][1].storeVersion).toBe('1.0.0');
    expect(createAppVersionAsyncSpy.mock.calls[0][1].buildVersion).toBe('1');
  });
});

function initBareWorkflowProject({
  versionCode = 123,
  versionName = '3.0.0',
}: {
  versionCode?: number | null;
  versionName?: string | null;
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
    ${versionCode ? `versionCode "${versionCode}"` : ''}
    ${versionName ? `versionName "${versionName}"` : ''}
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
