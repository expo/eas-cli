import { spawnAsync } from '@expo/steps';
import fs from 'node:fs';
import path from 'node:path';

jest.unmock('fs');
jest.unmock('node:fs');
jest.unmock('fs/promises');
jest.unmock('node:fs/promises');

jest.mock('@expo/steps', () => ({
  ...jest.requireActual('@expo/steps'),
  spawnAsync: jest.fn(),
}));

const mockedSpawnAsync = jest.mocked(spawnAsync);

import { parseInfoPlistBuffer } from '../readIpaInfo';
import {
  extractAndroidVersionAsync,
  extractIosVersionAsync,
  parseAaptOutput,
  parseManifestXml,
} from '../reportResolvedVersion';

describe(parseAaptOutput, () => {
  it('extracts versionName and versionCode from aapt2 output', () => {
    const output = `package: name='com.example.app' versionCode='42' versionName='2.5.0' platformBuildVersionName='14' platformBuildVersionCode='34' compileSdkVersion='34' compileSdkVersionCodename='14'
sdkVersion:'21'
targetSdkVersion:'34'
uses-permission: name='android.permission.INTERNET'`;

    expect(parseAaptOutput(output)).toEqual({
      appVersion: '2.5.0',
      appBuildVersion: '42',
    });
  });

  it('handles output with no version info', () => {
    expect(parseAaptOutput('some unrelated output')).toEqual({
      appVersion: undefined,
      appBuildVersion: undefined,
    });
  });

  it('handles versionName with prerelease suffix', () => {
    const output = `package: name='com.example' versionCode='1' versionName='1.0.0-beta.1'`;

    expect(parseAaptOutput(output)).toEqual({
      appVersion: '1.0.0-beta.1',
      appBuildVersion: '1',
    });
  });
});

describe(parseManifestXml, () => {
  it('extracts versionName and versionCode from bundletool manifest XML', () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    android:versionCode="10"
    android:versionName="3.1.0"
    package="com.example.app">
    <uses-sdk android:minSdkVersion="21" android:targetSdkVersion="34" />
</manifest>`;

    expect(parseManifestXml(xml)).toEqual({
      appVersion: '3.1.0',
      appBuildVersion: '10',
    });
  });

  it('handles XML with no version attributes', () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="com.example.app">
</manifest>`;

    expect(parseManifestXml(xml)).toEqual({
      appVersion: undefined,
      appBuildVersion: undefined,
    });
  });
});

describe('simulator .app Info.plist parsing', () => {
  const FIXTURES_DIR = path.join(__dirname, 'fixtures');
  const SIMULATOR_APP_DIR = path.join(FIXTURES_DIR, 'TestSimulator.app');
  const INFO_PLIST_PATH = path.join(SIMULATOR_APP_DIR, 'Info.plist');

  beforeAll(async () => {
    // Create a minimal XML Info.plist fixture
    await fs.promises.mkdir(SIMULATOR_APP_DIR, { recursive: true });
    await fs.promises.writeFile(
      INFO_PLIST_PATH,
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key>
  <string>com.example.test</string>
  <key>CFBundleShortVersionString</key>
  <string>4.2.0</string>
  <key>CFBundleVersion</key>
  <string>99</string>
</dict>
</plist>`
    );
  });

  afterAll(async () => {
    await fs.promises.rm(SIMULATOR_APP_DIR, { recursive: true, force: true });
  });

  it('reads version from a .app Info.plist', async () => {
    const buffer = await fs.promises.readFile(INFO_PLIST_PATH);
    const infoPlist = parseInfoPlistBuffer(buffer);

    expect(infoPlist.CFBundleShortVersionString).toBe('4.2.0');
    expect(infoPlist.CFBundleVersion).toBe('99');
  });
});

describe(extractIosVersionAsync, () => {
  const FIXTURES_DIR = path.join(__dirname, 'fixtures');
  const SIMULATOR_APP_DIR = path.join(FIXTURES_DIR, 'ExtractVersion.app');
  const INFO_PLIST_PATH = path.join(SIMULATOR_APP_DIR, 'Info.plist');
  const IPA_FIXTURE_PATH = path.join(FIXTURES_DIR, 'SmallestAppExample.ipa');

  beforeAll(async () => {
    await fs.promises.mkdir(SIMULATOR_APP_DIR, { recursive: true });
    await fs.promises.writeFile(
      INFO_PLIST_PATH,
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleShortVersionString</key>
  <string>2.0.1</string>
  <key>CFBundleVersion</key>
  <string>55</string>
</dict>
</plist>`
    );
  });

  afterAll(async () => {
    await fs.promises.rm(SIMULATOR_APP_DIR, { recursive: true, force: true });
  });

  it('extracts version from a .app directory', async () => {
    const result = await extractIosVersionAsync(SIMULATOR_APP_DIR);

    expect(result).toEqual({
      appVersion: '2.0.1',
      appBuildVersion: '55',
    });
  });

  it('extracts version from an .ipa file', async () => {
    const result = await extractIosVersionAsync(IPA_FIXTURE_PATH);

    expect(result).toEqual({
      appVersion: '1.0',
      appBuildVersion: '1',
    });
  });
});

describe(extractAndroidVersionAsync, () => {
  afterEach(() => {
    mockedSpawnAsync.mockReset();
  });

  it('extracts version from an .apk via aapt2', async () => {
    mockedSpawnAsync.mockResolvedValue({
      stdout: `package: name='com.example.app' versionCode='42' versionName='2.5.0'`,
      stderr: '',
    } as any);

    const result = await extractAndroidVersionAsync('/path/to/app.apk');

    expect(mockedSpawnAsync).toHaveBeenCalledWith(
      'aapt2',
      ['dump', 'badging', '/path/to/app.apk'],
      {
        stdio: 'pipe',
      }
    );
    expect(result).toEqual({
      appVersion: '2.5.0',
      appBuildVersion: '42',
    });
  });

  it('extracts version from an .aab via bundletool', async () => {
    mockedSpawnAsync.mockResolvedValue({
      stdout: `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    android:versionCode="10"
    android:versionName="3.1.0"
    package="com.example.app">
</manifest>`,
      stderr: '',
    } as any);

    const result = await extractAndroidVersionAsync('/path/to/app.aab');

    expect(mockedSpawnAsync).toHaveBeenCalledWith(
      'bundletool',
      ['dump', 'manifest', '--bundle', '/path/to/app.aab'],
      { stdio: 'pipe' }
    );
    expect(result).toEqual({
      appVersion: '3.1.0',
      appBuildVersion: '10',
    });
  });

  it('returns empty object for unknown extension', async () => {
    const result = await extractAndroidVersionAsync('/path/to/archive.zip');

    expect(mockedSpawnAsync).not.toHaveBeenCalled();
    expect(result).toEqual({});
  });
});
