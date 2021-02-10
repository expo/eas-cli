import { ExpoConfig } from '@expo/config';
import fs from 'fs-extra';
import { vol } from 'memfs';
import os from 'os';

import { readPlistAsync } from '../plist';
import { BumpStrategy, bumpVersionAsync, bumpVersionInAppJsonAsync } from '../version';

jest.mock('fs');

const originalConsoleLog = console.log;
beforeAll(() => {
  console.log = jest.fn();
});
afterAll(() => {
  console.log = originalConsoleLog;
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

// generic workflow
describe(bumpVersionAsync, () => {
  it('bumps expo.ios.buildNumber and CFBundleVersion when strategy = BumpStrategy.BuildNumber', async () => {
    const fakeExp = initGenericProject();

    await bumpVersionAsync({
      bumpStrategy: BumpStrategy.BuildNumber,
      projectDir: '/repo',
      exp: fakeExp,
    });

    const appJSON = await fs.readJSON('/repo/app.json');
    const infoPlist = await readPlistAsync('/repo/ios/myproject/Info.plist');
    expect(fakeExp.version).toBe('1.0.0');
    expect(fakeExp.ios.buildNumber).toBe('2');
    expect(appJSON.expo.version).toBe('1.0.0');
    expect(appJSON.expo.ios.buildNumber).toBe('2');
    expect(infoPlist['CFBundleShortVersionString']).toBe('1.0.0');
    expect(infoPlist['CFBundleVersion']).toBe('2');
  });

  it('bumps expo.version and CFBundleShortVersionString when strategy = BumpStrategy.ShortVersion', async () => {
    const fakeExp = initGenericProject();

    await bumpVersionAsync({
      bumpStrategy: BumpStrategy.ShortVersion,
      projectDir: '/repo',
      exp: fakeExp,
    });

    const appJSON = await fs.readJSON('/repo/app.json');
    const infoPlist = await readPlistAsync('/repo/ios/myproject/Info.plist');
    expect(fakeExp.version).toBe('1.0.1');
    expect(fakeExp.ios.buildNumber).toBe('1');
    expect(appJSON.expo.version).toBe('1.0.1');
    expect(appJSON.expo.ios.buildNumber).toBe('1');
    expect(infoPlist['CFBundleShortVersionString']).toBe('1.0.1');
    expect(infoPlist['CFBundleVersion']).toBe('1');
  });

  it('does not bump any version when strategy = BumpStrategy.Noop', async () => {
    const fakeExp = initGenericProject();

    await bumpVersionAsync({
      bumpStrategy: BumpStrategy.Noop,
      projectDir: '/repo',
      exp: fakeExp,
    });

    const appJSON = await fs.readJSON('/repo/app.json');
    const infoPlist = await readPlistAsync('/repo/ios/myproject/Info.plist');
    expect(fakeExp.version).toBe('1.0.0');
    expect(fakeExp.ios.buildNumber).toBe('1');
    expect(appJSON.expo.version).toBe('1.0.0');
    expect(appJSON.expo.ios.buildNumber).toBe('1');
    expect(infoPlist['CFBundleShortVersionString']).toBe('1.0.0');
    expect(infoPlist['CFBundleVersion']).toBe('1');
  });
});

// managed workflow
describe(bumpVersionInAppJsonAsync, () => {
  it('bumps expo.ios.buildNumber when strategy = BumpStrategy.BuildNumber', async () => {
    const fakeExp = initManagedProject();

    await bumpVersionInAppJsonAsync({
      bumpStrategy: BumpStrategy.BuildNumber,
      projectDir: '/repo',
      exp: fakeExp,
    });

    const appJSON = await fs.readJSON('/repo/app.json');
    expect(fakeExp.version).toBe('1.0.0');
    expect(fakeExp.ios.buildNumber).toBe('2');
    expect(appJSON.expo.version).toBe('1.0.0');
    expect(appJSON.expo.ios.buildNumber).toBe('2');
  });

  it('bumps expo.version when strategy = BumpStrategy.ShortVersion', async () => {
    const fakeExp = initManagedProject();

    await bumpVersionInAppJsonAsync({
      bumpStrategy: BumpStrategy.ShortVersion,
      projectDir: '/repo',
      exp: fakeExp,
    });

    const appJSON = await fs.readJSON('/repo/app.json');
    expect(fakeExp.version).toBe('1.0.1');
    expect(fakeExp.ios.buildNumber).toBe('1');
    expect(appJSON.expo.version).toBe('1.0.1');
    expect(appJSON.expo.ios.buildNumber).toBe('1');
  });

  it('does not bump any version when strategy = BumpStrategy.Noop', async () => {
    const fakeExp = initManagedProject();

    await bumpVersionInAppJsonAsync({
      bumpStrategy: BumpStrategy.Noop,
      projectDir: '/repo',
      exp: fakeExp,
    });

    const appJSON = await fs.readJSON('/repo/app.json');
    expect(fakeExp.version).toBe('1.0.0');
    expect(fakeExp.ios.buildNumber).toBe('1');
    expect(appJSON.expo.version).toBe('1.0.0');
    expect(appJSON.expo.ios.buildNumber).toBe('1');
  });
});

function initGenericProject(): ExpoConfig {
  vol.fromJSON(
    {
      './app.json': JSON.stringify({
        expo: {
          version: '1.0.0',
          ios: {
            buildNumber: '1',
          },
        },
      }),
      './ios/myproject/Info.plist': `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleShortVersionString</key>
  <string>1.0.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
</dict>
</plist>`,
    },
    '/repo'
  );

  const fakeExp: ExpoConfig = {
    name: 'myproject',
    slug: 'myproject',
    version: '1.0.0',
    ios: {
      buildNumber: '1',
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
          ios: {
            buildNumber: '1',
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
    ios: {
      buildNumber: '1',
    },
  };
  return fakeExp;
}
