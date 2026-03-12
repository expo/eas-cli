import fs from 'node:fs';
import path from 'node:path';

jest.unmock('fs');
jest.unmock('node:fs');
jest.unmock('fs/promises');
jest.unmock('node:fs/promises');

import { parseInfoPlistBuffer } from '../readIpaInfo';
import { parseAaptOutput, parseManifestXml } from '../reportResolvedVersion';

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
