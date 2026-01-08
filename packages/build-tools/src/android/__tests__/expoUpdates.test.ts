import path from 'path';

import { vol } from 'memfs';
import { AndroidConfig } from '@expo/config-plugins';

import {
  AndroidMetadataName,
  androidSetChannelNativelyAsync,
  androidGetNativelyDefinedChannelAsync,
  androidGetNativelyDefinedRuntimeVersionAsync,
  androidSetRuntimeVersionNativelyAsync,
} from '../expoUpdates';

jest.mock('fs');
const originalFs = jest.requireActual('fs');

const channel = 'easupdatechannel';
const manifestPath = '/app/android/app/src/main/AndroidManifest.xml';

afterEach(() => {
  vol.reset();
});

describe(androidSetChannelNativelyAsync, () => {
  it('sets the channel', async () => {
    vol.fromJSON(
      {
        'android/app/src/main/AndroidManifest.xml': originalFs.readFileSync(
          path.join(__dirname, 'fixtures/NoMetadataAndroidManifest.xml'),
          'utf-8'
        ),
      },
      '/app'
    );
    const ctx = {
      getReactNativeProjectDirectory: () => '/app',
      job: { updates: { channel } },
      logger: { info: () => {} },
    };

    await androidSetChannelNativelyAsync(ctx as any);

    const newAndroidManifest = await AndroidConfig.Manifest.readAndroidManifestAsync(manifestPath);
    const newValue = AndroidConfig.Manifest.getMainApplicationMetaDataValue(
      newAndroidManifest,
      AndroidMetadataName.UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY
    );
    expect(newValue).toBeDefined();
    expect(JSON.parse(newValue!)).toEqual({ 'expo-channel-name': channel });
  });
});

describe(androidGetNativelyDefinedChannelAsync, () => {
  it('gets the channel', async () => {
    vol.fromJSON(
      {
        'android/app/src/main/AndroidManifest.xml': originalFs.readFileSync(
          path.join(__dirname, 'fixtures/AndroidManifestWithChannel.xml'),
          'utf-8'
        ),
      },
      '/app'
    );
    const ctx = {
      getReactNativeProjectDirectory: () => '/app',
      logger: { info: () => {} },
    };

    await expect(androidGetNativelyDefinedChannelAsync(ctx as any)).resolves.toBe('staging-123');
  });
});

describe(androidGetNativelyDefinedRuntimeVersionAsync, () => {
  it('gets the native runtime version', async () => {
    vol.fromJSON(
      {
        'android/app/src/main/AndroidManifest.xml': originalFs.readFileSync(
          path.join(__dirname, 'fixtures/AndroidManifestWithRuntimeVersion.xml'),
          'utf-8'
        ),
      },
      '/app'
    );
    const ctx = {
      getReactNativeProjectDirectory: () => '/app',
      job: {},
      logger: { info: () => {} },
    };

    const nativelyDefinedRuntimeVersion = await androidGetNativelyDefinedRuntimeVersionAsync(
      ctx as any
    );
    expect(nativelyDefinedRuntimeVersion).toBe('exampleruntimeversion');
  });
});

describe(androidSetRuntimeVersionNativelyAsync, () => {
  it('sets the runtime version when nothing is set natively', async () => {
    vol.fromJSON(
      {
        'android/app/src/main/AndroidManifest.xml': originalFs.readFileSync(
          path.join(__dirname, 'fixtures/NoMetadataAndroidManifest.xml'),
          'utf-8'
        ),
      },
      '/app'
    );
    const ctx = {
      getReactNativeProjectDirectory: () => '/app',
      job: {},
      logger: { info: () => {} },
    };

    await androidSetRuntimeVersionNativelyAsync(ctx as any, '1.2.3');

    const newAndroidManifest = await AndroidConfig.Manifest.readAndroidManifestAsync(manifestPath);
    const newValue = AndroidConfig.Manifest.getMainApplicationMetaDataValue(
      newAndroidManifest,
      AndroidMetadataName.RUNTIME_VERSION
    );
    expect(newValue).toBe('1.2.3');
  });
  it('updates the runtime version when value is already set natively', async () => {
    vol.fromJSON(
      {
        'android/app/src/main/AndroidManifest.xml': originalFs.readFileSync(
          path.join(__dirname, 'fixtures/AndroidManifestWithRuntimeVersion.xml'),
          'utf-8'
        ),
      },
      '/app'
    );
    const ctx = {
      getReactNativeProjectDirectory: () => '/app',
      job: {},
      logger: { info: () => {} },
    };

    await androidSetRuntimeVersionNativelyAsync(ctx as any, '1.2.3');

    const newAndroidManifest = await AndroidConfig.Manifest.readAndroidManifestAsync(manifestPath);
    const newValue = AndroidConfig.Manifest.getMainApplicationMetaDataValue(
      newAndroidManifest,
      AndroidMetadataName.RUNTIME_VERSION
    );
    expect(newValue).toBe('1.2.3');
  });
});
