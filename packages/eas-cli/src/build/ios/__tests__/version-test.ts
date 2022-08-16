import { ExpoConfig } from '@expo/config';
import { IOSConfig } from '@expo/config-plugins';
import fs from 'fs-extra';
import { vol } from 'memfs';
import os from 'os';
import type { XCBuildConfiguration } from 'xcode';

import { readPlistAsync } from '../../../utils/plist';
import {
  BumpStrategy,
  bumpVersionAsync,
  bumpVersionInAppJsonAsync,
  evaluateTemplateString,
  getInfoPlistPath,
  readBuildNumberAsync,
  readShortVersionAsync,
} from '../version';

jest.mock('fs');

const getXCBuildConfigurationFromPbxproj = jest.spyOn(
  IOSConfig.Target,
  'getXCBuildConfigurationFromPbxproj'
);
const getPbxproj = jest.spyOn(IOSConfig.XcodeUtils, 'getPbxproj');

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

describe(evaluateTemplateString, () => {
  it('evaluates the template string when value is a number', () => {
    expect(evaluateTemplateString('$(BLAH_BLAH)', { BLAH_BLAH: 123 })).toBe('123');
  });
  it('evaluates the template string when value is a string', () => {
    expect(evaluateTemplateString('$(BLAH_BLAH)', { BLAH_BLAH: '123' })).toBe('123');
  });
  it('evaluates the template string when template is not the only element', () => {
    expect(evaluateTemplateString('before$(BLAH_BLAH)after', { BLAH_BLAH: '123' })).toBe(
      'before123after'
    );
  });
  it('evaluates the template string when template value is double quoted', () => {
    expect(evaluateTemplateString('before$(BLAH_BLAH)after', { BLAH_BLAH: '"123"' })).toBe(
      'before123after'
    );
  });
});

// bare workflow
describe(bumpVersionAsync, () => {
  beforeEach(() => {
    getPbxproj.mockImplementation(() => ({} as any));
  });
  afterEach(() => {
    getXCBuildConfigurationFromPbxproj.mockReset();
    getPbxproj.mockReset();
  });
  it('bumps expo.ios.buildNumber and CFBundleVersion when strategy = BumpStrategy.BUILD_NUMBER', async () => {
    const fakeExp = initBareWorkflowProject();
    getXCBuildConfigurationFromPbxproj.mockImplementation(
      () =>
        ({
          buildSettings: {
            INFOPLIST_FILE: 'myproject/Info.plist',
          },
        } as XCBuildConfiguration)
    );
    await bumpVersionAsync({
      bumpStrategy: BumpStrategy.BUILD_NUMBER,
      projectDir: '/repo',
      exp: fakeExp,
      targets: [
        {
          targetName: 'example',
          bundleIdentifier: 'example.com',
          entitlements: {},
        },
      ],
    });

    const appJSON = await fs.readJSON('/repo/app.json');
    const infoPlist = (await readPlistAsync(
      '/repo/ios/myproject/Info.plist'
    )) as IOSConfig.InfoPlist;
    expect(fakeExp.version).toBe('1.0.0');
    expect(fakeExp.ios?.buildNumber).toBe('2');
    expect(appJSON.expo.version).toBe('1.0.0');
    expect(appJSON.expo.ios.buildNumber).toBe('2');
    expect(infoPlist['CFBundleShortVersionString']).toBe('1.0.0');
    expect(infoPlist['CFBundleVersion']).toBe('2');
  });

  it('bumps expo.ios.buildNumber and CFBundleVersion for non default Info.plist location', async () => {
    const fakeExp = initBareWorkflowProject({ infoPlistName: 'Info2.plist' });

    getXCBuildConfigurationFromPbxproj.mockImplementation(
      () =>
        ({
          buildSettings: {
            INFOPLIST_FILE: '$(SRCROOT)/myproject/Info2.plist',
          },
        } as XCBuildConfiguration)
    );
    await bumpVersionAsync({
      bumpStrategy: BumpStrategy.BUILD_NUMBER,
      projectDir: '/repo',
      exp: fakeExp,
      targets: [
        {
          targetName: 'example',
          bundleIdentifier: 'example.com',
          entitlements: {},
        },
      ],
    });

    const appJSON = await fs.readJSON('/repo/app.json');
    const infoPlist = (await readPlistAsync(
      '/repo/ios/myproject/Info2.plist'
    )) as IOSConfig.InfoPlist;
    expect(fakeExp.version).toBe('1.0.0');
    expect(fakeExp.ios?.buildNumber).toBe('2');
    expect(appJSON.expo.version).toBe('1.0.0');
    expect(appJSON.expo.ios.buildNumber).toBe('2');
    expect(infoPlist['CFBundleShortVersionString']).toBe('1.0.0');
    expect(infoPlist['CFBundleVersion']).toBe('2');
  });

  it('bumps expo.version and CFBundleShortVersionString when strategy = BumpStrategy.APP_VERSION', async () => {
    const fakeExp = initBareWorkflowProject();
    getXCBuildConfigurationFromPbxproj.mockImplementation(
      () =>
        ({
          buildSettings: {
            INFOPLIST_FILE: 'myproject/Info.plist',
          },
        } as XCBuildConfiguration)
    );
    await bumpVersionAsync({
      bumpStrategy: BumpStrategy.APP_VERSION,
      projectDir: '/repo',
      exp: fakeExp,
      targets: [
        {
          targetName: 'example',
          bundleIdentifier: 'example.com',
          entitlements: {},
        },
      ],
    });

    const appJSON = await fs.readJSON('/repo/app.json');
    const infoPlist = (await readPlistAsync(
      '/repo/ios/myproject/Info.plist'
    )) as IOSConfig.InfoPlist;
    expect(fakeExp.version).toBe('1.0.1');
    expect(fakeExp.ios?.buildNumber).toBe('1');
    expect(appJSON.expo.version).toBe('1.0.1');
    expect(appJSON.expo.ios.buildNumber).toBe('1');
    expect(infoPlist['CFBundleShortVersionString']).toBe('1.0.1');
    expect(infoPlist['CFBundleVersion']).toBe('1');
  });

  it('does not bump any version when strategy = BumpStrategy.NOOP', async () => {
    const fakeExp = initBareWorkflowProject();
    getXCBuildConfigurationFromPbxproj.mockImplementation(
      () =>
        ({
          buildSettings: {
            INFOPLIST_FILE: 'myproject/Info.plist',
          },
        } as XCBuildConfiguration)
    );
    await bumpVersionAsync({
      bumpStrategy: BumpStrategy.NOOP,
      projectDir: '/repo',
      exp: fakeExp,
      targets: [
        {
          targetName: 'example',
          bundleIdentifier: 'example.com',
          entitlements: {},
        },
      ],
    });

    const appJSON = await fs.readJSON('/repo/app.json');
    const infoPlist = (await readPlistAsync(
      '/repo/ios/myproject/Info.plist'
    )) as IOSConfig.InfoPlist;
    expect(fakeExp.version).toBe('1.0.0');
    expect(fakeExp.ios?.buildNumber).toBe('1');
    expect(appJSON.expo.version).toBe('1.0.0');
    expect(appJSON.expo.ios.buildNumber).toBe('1');
    expect(infoPlist['CFBundleShortVersionString']).toBe('1.0.0');
    expect(infoPlist['CFBundleVersion']).toBe('1');
  });
});

// managed workflow
describe(bumpVersionInAppJsonAsync, () => {
  it('bumps expo.ios.buildNumber when strategy = BumpStrategy.BUILD_NUMBER', async () => {
    const fakeExp = initManagedProject();

    await bumpVersionInAppJsonAsync({
      bumpStrategy: BumpStrategy.BUILD_NUMBER,
      projectDir: '/repo',
      exp: fakeExp,
    });

    const appJSON = await fs.readJSON('/repo/app.json');
    expect(fakeExp.version).toBe('1.0.0');
    expect(fakeExp.ios?.buildNumber).toBe('2');
    expect(appJSON.expo.version).toBe('1.0.0');
    expect(appJSON.expo.ios.buildNumber).toBe('2');
  });

  it('bumps expo.version when strategy = BumpStrategy.SHORT_VERSION', async () => {
    const fakeExp = initManagedProject();

    await bumpVersionInAppJsonAsync({
      bumpStrategy: BumpStrategy.APP_VERSION,
      projectDir: '/repo',
      exp: fakeExp,
    });

    const appJSON = await fs.readJSON('/repo/app.json');
    expect(fakeExp.version).toBe('1.0.1');
    expect(fakeExp.ios?.buildNumber).toBe('1');
    expect(appJSON.expo.version).toBe('1.0.1');
    expect(appJSON.expo.ios.buildNumber).toBe('1');
  });

  it('does not bump any version when strategy = BumpStrategy.NOOP', async () => {
    const fakeExp = initManagedProject();

    await bumpVersionInAppJsonAsync({
      bumpStrategy: BumpStrategy.NOOP,
      projectDir: '/repo',
      exp: fakeExp,
    });

    const appJSON = await fs.readJSON('/repo/app.json');
    expect(fakeExp.version).toBe('1.0.0');
    expect(fakeExp.ios?.buildNumber).toBe('1');
    expect(appJSON.expo.version).toBe('1.0.0');
    expect(appJSON.expo.ios.buildNumber).toBe('1');
  });
});

describe(readBuildNumberAsync, () => {
  describe('bare project', () => {
    it('reads the build number from native code', async () => {
      const exp = initBareWorkflowProject();
      const buildNumber = await readBuildNumberAsync('/repo', exp, {});
      expect(buildNumber).toBe('1');
    });
  });

  describe('managed project', () => {
    it('reads the build number from expo config', async () => {
      const exp = initManagedProject();
      const buildNumber = await readBuildNumberAsync('/repo', exp, {});
      expect(buildNumber).toBe('1');
    });
  });
});

describe(readShortVersionAsync, () => {
  describe('bare project', () => {
    it('reads the short version from native code', async () => {
      const exp = initBareWorkflowProject();
      const appVersion = await readShortVersionAsync('/repo', exp, {});
      expect(appVersion).toBe('1.0.0');
    });
    it('evaluates interpolated build number', async () => {
      const exp = initBareWorkflowProject({
        appVersion: '$(CURRENT_PROJECT_VERSION)',
      });
      const buildNumber = await readShortVersionAsync('/repo', exp, {
        CURRENT_PROJECT_VERSION: '1.0.0',
      });
      expect(buildNumber).toBe('1.0.0');
    });
  });

  describe('managed project', () => {
    it('reads the version from app config', async () => {
      const exp = initBareWorkflowProject();
      const appVersion = await readShortVersionAsync('/repo', exp, {});
      expect(appVersion).toBe('1.0.0');
    });
  });
});

describe(getInfoPlistPath, () => {
  it('returns default path if INFOPLIST_FILE is not specified', () => {
    vol.fromJSON(
      {
        './ios/testapp/Info.plist': '',
      },
      '/repo'
    );
    const plistPath = getInfoPlistPath('/repo', {});
    expect(plistPath).toBe('/repo/ios/testapp/Info.plist');
  });
  it('returns INFOPLIST_FILE if specified', () => {
    vol.fromJSON(
      {
        './ios/testapp/Info.plist': '',
      },
      '/repo'
    );
    const plistPath = getInfoPlistPath('/repo', { INFOPLIST_FILE: './qwert/NotInfo.plist' });
    expect(plistPath).toBe('/repo/ios/qwert/NotInfo.plist');
  });
  it('evaluates SRCROOT in Info.plist', () => {
    vol.fromJSON(
      {
        './ios/testapp/Info.plist': '',
      },
      '/repo'
    );
    const plistPath = getInfoPlistPath('/repo', {
      INFOPLIST_FILE: '$(SRCROOT)/qwert/NotInfo.plist',
    });
    expect(plistPath).toBe('/repo/ios/qwert/NotInfo.plist');
  });
  it('evaluates BuildSettings in Info.plist', () => {
    vol.fromJSON(
      {
        './ios/testapp/Info.plist': '',
      },
      '/repo'
    );
    const plistPath = getInfoPlistPath('/repo', {
      INFOPLIST_FILE: '$(SRCROOT)/qwert/$(TARGET_NAME).plist',
      TARGET_NAME: 'NotInfo',
    });
    expect(plistPath).toBe('/repo/ios/qwert/NotInfo.plist');
  });
});

function initBareWorkflowProject({
  appVersion = '1.0.0',
  buildNumber = '1',
  infoPlistName = 'Info.plist',
}: { appVersion?: string; buildNumber?: string; infoPlistName?: string } = {}): ExpoConfig {
  const fakeExp: ExpoConfig = {
    name: 'myproject',
    slug: 'myproject',
    version: '1.0.0',
    ios: {
      buildNumber: '1',
    },
  };
  vol.fromJSON(
    {
      './app.json': JSON.stringify({
        expo: fakeExp,
      }),
      [`./ios/myproject/${infoPlistName}`]: `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleShortVersionString</key>
  <string>${appVersion}</string>
  <key>CFBundleVersion</key>
  <string>${buildNumber}</string>
</dict>
</plist>`,
    },
    '/repo'
  );

  return fakeExp;
}

function initManagedProject(): ExpoConfig {
  const fakeExp: ExpoConfig = {
    name: 'myproject',
    slug: 'myproject',
    version: '1.0.0',
    ios: {
      buildNumber: '1',
    },
  };

  vol.fromJSON(
    {
      './app.json': JSON.stringify({
        expo: fakeExp,
      }),
    },
    '/repo'
  );

  return fakeExp;
}
