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
const IPA_BUILD_NUMBER = '1';

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

interface VerifyOptions {
  simulator: boolean;
  archivePath: string;
  expectedIdentifier?: string;
  expectedBuildNumber?: string;
}

function createVerifyStep({
  simulator,
  archivePath,
  expectedIdentifier,
  expectedBuildNumber,
}: VerifyOptions): ReturnType<
  ReturnType<typeof createVerifyNativeIosBuildFunction>['createBuildStepFromFunctionCall']
> {
  const globalCtx = createGlobalContextMock({ staticContextContent: { job: { simulator } } });
  return createVerifyNativeIosBuildFunction().createBuildStepFromFunctionCall(globalCtx, {
    callInputs: {
      archive_path: archivePath,
      expected_identifier: expectedIdentifier,
      expected_build_number: expectedBuildNumber,
    },
  });
}

async function verifyAsync(options: VerifyOptions): Promise<void> {
  await createVerifyStep(options).executeAsync();
}

async function verifyAndReadWarningsAsync(options: VerifyOptions): Promise<unknown[][]> {
  const step = createVerifyStep(options);
  await step.executeAsync();
  return jest.mocked(step.ctx.logger.warn).mock.calls;
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

  it('says nothing about the build number when the artifact has the expected one, or when none is expected', async () => {
    await expect(
      verifyAndReadWarningsAsync({
        simulator: false,
        archivePath: IPA_PATH,
        expectedBuildNumber: IPA_BUILD_NUMBER,
      })
    ).resolves.toEqual([]);
    await expect(
      verifyAndReadWarningsAsync({ simulator: false, archivePath: IPA_PATH })
    ).resolves.toEqual([]);
  });

  it('warns with both numbers and the way out, and does not fail, when the artifact has another build number', async () => {
    await expect(
      verifyAndReadWarningsAsync({
        simulator: false,
        archivePath: IPA_PATH,
        expectedBuildNumber: '43',
      })
    ).resolves.toEqual([
      [
        'EAS set the build number to 43, but the built app has 1. The build of the project does not use the number that EAS set; a build phase script or a preprocessed Info.plist file can cause this. To build with the number of the project, set "auto_increment: false".',
      ],
    ]);
  });

  it('warns when a build number is expected and the simulator app has none', async () => {
    await expect(
      verifyAndReadWarningsAsync({
        simulator: true,
        archivePath: await writeAppAsync('dev.expo.nativeapp', 'iphonesimulator'),
        expectedBuildNumber: '43',
      })
    ).resolves.toEqual([
      [
        expect.stringContaining(
          'EAS set the build number to 43, but the built app has no build number.'
        ),
      ],
    ]);
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
