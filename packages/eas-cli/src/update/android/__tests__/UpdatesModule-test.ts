import fs from 'fs-extra';
import { vol } from 'memfs';
import os from 'os';

import { readChannelSafelyAsync } from '../UpdatesModule.js';

jest.mock('fs');

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

const testChannel = 'test-channel';
describe(readChannelSafelyAsync, () => {
  it('retrieves the channel when it is defined natively', async () => {
    vol.fromJSON(
      {
        './android/app/src/main/AndroidManifest.xml': AndroidManifestWithChannel,
      },
      '/expo-project'
    );
    const channel = await readChannelSafelyAsync('/expo-project');
    expect(channel).toBe(testChannel);
  });
  it('returns null if the channel is not defined natively', async () => {
    vol.fromJSON(
      {
        './android/app/src/main/AndroidManifest.xml': AndroidManifestNoChannel,
      },
      '/expo-project'
    );
    const channel = await readChannelSafelyAsync('/expo-project');
    expect(channel).toBeNull();
  });
});

const AndroidManifestWithChannel = `
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
  package="com.expo.mycoolapp">

    <uses-permission android:name="android.permission.INTERNET" />

    <application
      android:name=".MainApplication"
      android:label="@string/app_name"
      android:icon="@mipmap/ic_launcher"
      android:roundIcon="@mipmap/ic_launcher_round"
      android:allowBackup="true"
      android:theme="@style/AppTheme">
      <meta-data android:name="expo.modules.updates.UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY" android:value='{"expo-channel-name":"${testChannel}"}'/>

      <activity
        android:name=".MainActivity"
        android:launchMode="singleTask"
        android:label="@string/app_name"
        android:configChanges="keyboard|keyboardHidden|orientation|screenSize"
        android:windowSoftInputMode="adjustResize">
        <intent-filter>
            <action android:name="android.intent.action.MAIN" />
            <category android:name="android.intent.category.LAUNCHER" />
        </intent-filter>
      </activity>
      <activity android:name="com.facebook.react.devsupport.DevSettingsActivity" />
    </application>


</manifest>
`;
const AndroidManifestNoChannel = `
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
  package="com.expo.mycoolapp">

    <uses-permission android:name="android.permission.INTERNET" />

    <application
      android:name=".MainApplication"
      android:label="@string/app_name"
      android:icon="@mipmap/ic_launcher"
      android:roundIcon="@mipmap/ic_launcher_round"
      android:allowBackup="true"
      android:theme="@style/AppTheme">

      <activity
        android:name=".MainActivity"
        android:launchMode="singleTask"
        android:label="@string/app_name"
        android:configChanges="keyboard|keyboardHidden|orientation|screenSize"
        android:windowSoftInputMode="adjustResize">
        <intent-filter>
            <action android:name="android.intent.action.MAIN" />
            <category android:name="android.intent.category.LAUNCHER" />
        </intent-filter>
      </activity>
      <activity android:name="com.facebook.react.devsupport.DevSettingsActivity" />
    </application>


</manifest>
`;
