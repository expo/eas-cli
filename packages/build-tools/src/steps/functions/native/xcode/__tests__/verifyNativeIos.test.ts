import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

jest.unmock('fs');
jest.unmock('node:fs');
jest.unmock('fs/promises');
jest.unmock('node:fs/promises');

import { createGlobalContextMock } from '../../../../../__tests__/utils/context';
import { createVerifyNativeIosBuildFunction } from '../verifyNativeIos';

const IPA_PATH = path.join(__dirname, '../../../__tests__/fixtures/SmallestAppExample.ipa');
const IPA_BUNDLE_IDENTIFIER = 'dev.expo.SmallestAppExample';

async function writeAppAsync(bundleIdentifier: string, platformName: string): Promise<string> {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'verify-native-ios-'));
  const appPath = path.join(directory, 'NativeApp.app');
  await fs.promises.mkdir(appPath);
  await fs.promises.writeFile(
    path.join(appPath, 'Info.plist'),
    `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>${bundleIdentifier}</string>
<key>DTPlatformName</key><string>${platformName}</string>
</dict></plist>`
  );
  return appPath;
}

async function verifyAsync({
  simulator,
  archivePath,
  expectedIdentifier,
}: {
  simulator: boolean;
  archivePath: string;
  expectedIdentifier?: string;
}): Promise<void> {
  const globalCtx = createGlobalContextMock({ staticContextContent: { job: { simulator } } });
  await createVerifyNativeIosBuildFunction()
    .createBuildStepFromFunctionCall(globalCtx, {
      callInputs: { archive_path: archivePath, expected_identifier: expectedIdentifier },
    })
    .executeAsync();
}

describe(createVerifyNativeIosBuildFunction, () => {
  it('accepts an IPA for devices with the expected identifier', async () => {
    await expect(
      verifyAsync({
        simulator: false,
        archivePath: IPA_PATH,
        expectedIdentifier: IPA_BUNDLE_IDENTIFIER,
      })
    ).resolves.toBeUndefined();
  });

  it('accepts a simulator app with the expected identifier', async () => {
    await expect(
      verifyAsync({
        simulator: true,
        archivePath: await writeAppAsync('dev.expo.nativeapp', 'iphonesimulator'),
        expectedIdentifier: 'dev.expo.nativeapp',
      })
    ).resolves.toBeUndefined();
  });

  it('accepts an artifact when no identifier is expected', async () => {
    await expect(verifyAsync({ simulator: false, archivePath: IPA_PATH })).resolves.toBeUndefined();
  });

  it('fails when the identifier of the artifact differs', async () => {
    await expect(
      verifyAsync({ simulator: false, archivePath: IPA_PATH, expectedIdentifier: 'dev.expo.other' })
    ).rejects.toMatchObject({
      errorCode: 'NATIVE_XCODE_ARTIFACT_IDENTIFIER_MISMATCH',
      message: expect.stringMatching(/"dev\.expo\.SmallestAppExample".*"dev\.expo\.other"/),
    });
  });

  it('fails when a simulator build produced an artifact for devices', async () => {
    await expect(verifyAsync({ simulator: true, archivePath: IPA_PATH })).rejects.toMatchObject({
      errorCode: 'NATIVE_XCODE_ARTIFACT_PLATFORM_MISMATCH',
    });
  });

  it('fails when a device build produced an artifact for the simulator', async () => {
    await expect(
      verifyAsync({
        simulator: false,
        archivePath: await writeAppAsync('dev.expo.nativeapp', 'iphonesimulator'),
      })
    ).rejects.toMatchObject({
      errorCode: 'NATIVE_XCODE_ARTIFACT_PLATFORM_MISMATCH',
      message: expect.stringContaining('"iphonesimulator"'),
    });
  });
});
