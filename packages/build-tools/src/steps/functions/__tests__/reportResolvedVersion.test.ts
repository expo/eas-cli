import { BuildStep, spawnAsync } from '@expo/steps';
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

import { createGlobalContextMock } from '../../../__tests__/utils/context';
import { createTestAndroidJob } from '../../../__tests__/utils/job';
import { createMockLogger } from '../../../__tests__/utils/logger';
import { BuildContext } from '../../../context';
import { CustomBuildContext } from '../../../customBuildContext';
import { parseInfoPlistBuffer } from '../readIpaInfo';
import {
  createReportResolvedVersionBuildFunction,
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

  it('keeps an unescaped apostrophe in versionName', () => {
    const output = `package: name='com.example' versionCode='1' versionName='1.0-O'Brien' platformBuildVersionName='14' platformBuildVersionCode='34' compileSdkVersion='34'
sdkVersion:'21'`;

    expect(parseAaptOutput(output)).toEqual({
      appVersion: "1.0-O'Brien",
      appBuildVersion: '1',
    });
  });

  it('keeps a versionName that contains a quote and an equals sign', () => {
    const output = `package: name='com.example' versionCode='1' versionName='1.0' build=beta'
sdkVersion:'21'`;

    expect(parseAaptOutput(output)).toEqual({
      appVersion: "1.0' build=beta",
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

describe(createReportResolvedVersionBuildFunction, () => {
  afterEach(() => {
    mockedSpawnAsync.mockReset();
  });

  function createStep({
    env,
    archivePath,
    workingDirectory,
    mutationResult = { data: {}, error: undefined },
  }: {
    env: Record<string, string>;
    archivePath?: string;
    workingDirectory?: string;
    mutationResult?: { data?: unknown; error?: Error };
  }): { step: BuildStep; mutation: jest.Mock } {
    const mutation = jest.fn(() => ({ toPromise: async () => mutationResult }));
    const ctx = new BuildContext(createTestAndroidJob({}), {
      env: { __API_SERVER_URL: 'http://api.expo.test', ...env },
      logBuffer: { getLogs: () => [], getPhaseLogs: () => [] },
      logger: createMockLogger(),
      uploadArtifact: jest.fn(),
      workingdir: '',
    });
    ctx.graphqlClient.mutation = mutation as any;
    const step = createReportResolvedVersionBuildFunction(
      new CustomBuildContext(ctx)
    ).createBuildStepFromFunctionCall(createGlobalContextMock({}), {
      callInputs: archivePath ? { application_archive_path: archivePath } : {},
      workingDirectory,
    });
    return { step, mutation };
  }

  it('resolves a relative archive path against the step working directory', async () => {
    mockedSpawnAsync.mockResolvedValue({
      stdout: `package: name='com.example.app' versionCode='42' versionName='2.5.0'`,
      stderr: '',
    } as any);
    const { step, mutation } = createStep({
      env: { EAS_BUILD_ID: 'build-id' },
      archivePath: 'android/app/build/outputs/apk/release/app-release.apk',
      workingDirectory: './my-app',
    });

    await step.executeAsync();

    const expectedPath = path.join(
      step.ctx.workingDirectory,
      'android/app/build/outputs/apk/release/app-release.apk'
    );
    expect(path.isAbsolute(expectedPath)).toBe(true);
    expect(mockedSpawnAsync).toHaveBeenCalledWith('aapt2', ['dump', 'badging', expectedPath], {
      stdio: 'pipe',
    });
    expect(mutation).toHaveBeenCalledTimes(1);
  });

  it('reports the resolved versions for the build', async () => {
    mockedSpawnAsync.mockResolvedValue({
      stdout: `package: name='com.example.app' versionCode='42' versionName='2.5.0'`,
      stderr: '',
    } as any);
    const { step, mutation } = createStep({
      env: { EAS_BUILD_ID: 'build-id' },
      archivePath: '/path/to/app.apk',
    });

    await step.executeAsync();

    expect(mutation).toHaveBeenCalledTimes(1);
    expect(mutation.mock.calls[0][1]).toEqual({
      buildId: 'build-id',
      appVersion: '2.5.0',
      appBuildVersion: '42',
    });
  });

  it('omits a missing value instead of sending null', async () => {
    mockedSpawnAsync.mockResolvedValue({
      stdout: `package: name='com.example.app' versionCode='42'`,
      stderr: '',
    } as any);
    const { step, mutation } = createStep({
      env: { EAS_BUILD_ID: 'build-id' },
      archivePath: '/path/to/app.apk',
    });

    await step.executeAsync();

    const variables = mutation.mock.calls[0][1];
    expect(variables.appBuildVersion).toBe('42');
    expect(variables.appVersion).toBeUndefined();
    expect(variables.appVersion).not.toBeNull();
  });

  it('does nothing without a build ID', async () => {
    const { step, mutation } = createStep({ env: {}, archivePath: '/path/to/app.apk' });

    await step.executeAsync();

    expect(mockedSpawnAsync).not.toHaveBeenCalled();
    expect(mutation).not.toHaveBeenCalled();
  });

  it('does nothing without an archive path', async () => {
    const { step, mutation } = createStep({ env: { EAS_BUILD_ID: 'build-id' } });

    await step.executeAsync();

    expect(mockedSpawnAsync).not.toHaveBeenCalled();
    expect(mutation).not.toHaveBeenCalled();
  });

  it('does not fail the step when extraction or the mutation fails', async () => {
    mockedSpawnAsync.mockRejectedValueOnce(new Error('aapt2: command not found'));
    const failingExtraction = createStep({
      env: { EAS_BUILD_ID: 'build-id' },
      archivePath: '/path/to/app.apk',
    });
    await expect(failingExtraction.step.executeAsync()).resolves.not.toThrow();
    expect(failingExtraction.mutation).not.toHaveBeenCalled();

    mockedSpawnAsync.mockResolvedValue({
      stdout: `package: name='com.example.app' versionCode='42' versionName='2.5.0'`,
      stderr: '',
    } as any);
    const failingMutation = createStep({
      env: { EAS_BUILD_ID: 'build-id' },
      archivePath: '/path/to/app.apk',
      mutationResult: { error: new Error('GraphQL error') },
    });
    await expect(failingMutation.step.executeAsync()).resolves.not.toThrow();
    expect(failingMutation.mutation).toHaveBeenCalledTimes(1);
  });
});
