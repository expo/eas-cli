import fs from 'fs-extra';
import { vol } from 'memfs';
import os from 'os';

import { readChannelSafelyAsync } from '../UpdatesModule';

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
        'ios/expo-project/Supporting/Expo.plist': ExpoPlistWithChannel,
        'ios/expo-project/AppDelegate.m': '',
      },
      '/expo-project'
    );
    const channel = await readChannelSafelyAsync('/expo-project');
    expect(channel).toBe(testChannel);
  });
  it('returns null if the channel is not defined natively', async () => {
    vol.fromJSON(
      {
        'ios/expo-project/Supporting/Expo.plist': ExpoPlistWithOutChannel,
        'ios/expo-project/AppDelegate.m': '',
      },
      '/expo-project'
    );
    const channel = await readChannelSafelyAsync('/expo-project');
    expect(channel).toBeNull();
  });
});

const ExpoPlistWithChannel = `
<plist version="1.0">
  <dict>
    <key>EXUpdatesCheckOnLaunch</key>
    <string>ALWAYS</string>
    <key>EXUpdatesEnabled</key>
    <true/>
    <key>EXUpdatesLaunchWaitMs</key>
    <integer>0</integer>
    <key>EXUpdatesSDKVersion</key>
    <string>40.0.0</string>
    <key>EXUpdatesURL</key>
    <string>https://exp.host/@user/expo-project</string>
    <key>EXUpdatesRequestHeaders</key>
		<dict>
			<key>expo-channel-name</key>
			<string>${testChannel}</string>
		</dict>
  </dict>
</plist>
`;
const ExpoPlistWithOutChannel = `
<plist version="1.0">
  <dict>
    <key>EXUpdatesCheckOnLaunch</key>
    <string>ALWAYS</string>
    <key>EXUpdatesEnabled</key>
    <true/>
    <key>EXUpdatesLaunchWaitMs</key>
    <integer>0</integer>
    <key>EXUpdatesSDKVersion</key>
    <string>40.0.0</string>
    <key>EXUpdatesURL</key>
    <string>https://exp.host/@user/expo-project</string>
  </dict>
</plist>
`;
