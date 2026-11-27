import fs from 'node:fs';
import path from 'node:path';

jest.unmock('fs');
jest.unmock('node:fs');
jest.unmock('fs/promises');
jest.unmock('node:fs/promises');

import { createGlobalContextMock } from '../../../__tests__/utils/context';
import { createReadIpaInfoBuildFunction, readAppName, readIpaInfoAsync } from '../readIpaInfo';

const NO_INFO_PLIST_IPA_BASE64 =
  'UEsDBAoAAAAAAPRcUFwAAAAAAAAAAAAAAAAIABwAUGF5bG9hZC9VVAkAA+zzkmns85JpdXgLAAEE9QEAAAQUAAAAUEsDBAoAAAAAAPRcUFwAAAAAAAAAAAAAAAAUABwAUGF5bG9hZC9UZXN0QXBwLmFwcC9VVAkAA+zzkmns85JpdXgLAAEE9QEAAAQUAAAAUEsDBAoAAAAAAPRcUFwgMDo2BgAAAAYAAAAeABwAUGF5bG9hZC9UZXN0QXBwLmFwcC9SZWFkbWUudHh0VVQJAAPs85Jp7POSaXV4CwABBPUBAAAEFAAAAGhlbGxvClBLAQIeAwoAAAAAAPRcUFwAAAAAAAAAAAAAAAAIABgAAAAAAAAAEADtQQAAAABQYXlsb2FkL1VUBQAD7POSaXV4CwABBPUBAAAEFAAAAFBLAQIeAwoAAAAAAPRcUFwAAAAAAAAAAAAAAAAUABgAAAAAAAAAEADtQUIAAABQYXlsb2FkL1Rlc3RBcHAuYXBwL1VUBQAD7POSaXV4CwABBPUBAAAEFAAAAFBLAQIeAwoAAAAAAPRcUFwgMDo2BgAAAAYAAAAeABgAAAAAAAEAAACkgZAAAABQYXlsb2FkL1Rlc3RBcHAuYXBwL1JlYWRtZS50eHRVVAUAA+zzkml1eAsAAQT1AQAABBQAAABQSwUGAAAAAAMAAwAMAQAA7gAAAAAA';
const MISSING_BUNDLE_VERSION_IPA_BASE64 =
  'UEsDBAoAAAAAAPRcUFwAAAAAAAAAAAAAAAAIABwAUGF5bG9hZC9VVAkAA+zzkmns85JpdXgLAAEE9QEAAAQUAAAAUEsDBAoAAAAAAPRcUFwAAAAAAAAAAAAAAAAUABwAUGF5bG9hZC9UZXN0QXBwLmFwcC9VVAkAA+zzkmns85JpdXgLAAEE9QEAAAQUAAAAUEsDBBQAAAAIAPRcUFz9BfqM2wAAAEQBAAAeABwAUGF5bG9hZC9UZXN0QXBwLmFwcC9JbmZvLnBsaXN0VVQJAAPs85Jp7POSaXV4CwABBPUBAAAEFAAAAGWOUUvDMBSF3/srYt6b6/RFJMtw7QaFooV2go+jybZgm4Tkard/b7IKor7ec+73Hb46jwP5VD5oa5Z0wW4pUaa3Upvjku66bf5AVyLjN+VL0b01G+IGHZA0u3VdFYTmAE/ODQqg7ErS1FXbkcgA2DxTQk+I7hFgmia2Ty3W2zEVAzTeOuXxUkdYHh+YREmjZqb/mhOvUvcoMkL4u7qIYrv+MHJQlVQG9UErzyHdUx7Qx90iapg678ekRBUwyjl8Z38x7cl6fJ2F7bXyD7dgd+z+B8Bh3sPhulZkX1BLAQIeAwoAAAAAAPRcUFwAAAAAAAAAAAAAAAAIABgAAAAAAAAAEADtQQAAAABQYXlsb2FkL1VUBQAD7POSaXV4CwABBPUBAAAEFAAAAFBLAQIeAwoAAAAAAPRcUFwAAAAAAAAAAAAAAAAUABgAAAAAAAAAEADtQUIAAABQYXlsb2FkL1Rlc3RBcHAuYXBwL1VUBQAD7POSaXV4CwABBPUBAAAEFAAAAFBLAQIeAxQAAAAIAPRcUFz9BfqM2wAAAEQBAAAeABgAAAAAAAEAAACkgZAAAABQYXlsb2FkL1Rlc3RBcHAuYXBwL0luZm8ucGxpc3RVVAUAA+zzkml1eAsAAQT1AQAABBQAAABQSwUGAAAAAAMAAwAMAQAAwwEAAAAA';
const NO_NAME_KEYS_IPA_BASE64 =
  'UEsDBAoAAAAAAPe4el0AAAAAAAAAAAAAAAAIAAAAUGF5bG9hZC9QSwMECgAAAAAA97h6XQAAAAAAAAAAAAAAABQAAABQYXlsb2FkL1Rlc3RBcHAuYXBwL1BLAwQUAAAACAD3uHpdeIgUypAAAAD5AAAAHgAAAFBheWxvYWQvVGVzdEFwcC5hcHAvSW5mby5wbGlzdHWPsQ7CIBCG9z5Fwy5YFx2uNNGkiXPV3ZRTiQgEzqa+vRU7yOB6//f9dwfN+DDlgCFqZ2tW8SUr0fZOaXut2fHQLjaskQV4oyPlnASle5qyO77krt0+rTK4V2hJXzQGEJ85RApTlVQ4cBy944SRzt6DmINc724u0Om7pUtAXrPi1R9zlnJ8/QOLdC2I9Iks3lBLAQIeAwoAAAAAAPe4el0AAAAAAAAAAAAAAAAIAAAAAAAAAAAAEADtQQAAAABQYXlsb2FkL1BLAQIeAwoAAAAAAPe4el0AAAAAAAAAAAAAAAAUAAAAAAAAAAAAEADtQSYAAABQYXlsb2FkL1Rlc3RBcHAuYXBwL1BLAQIeAxQAAAAIAPe4el14iBTKkAAAAPkAAAAeAAAAAAAAAAEAAACkgVgAAABQYXlsb2FkL1Rlc3RBcHAuYXBwL0luZm8ucGxpc3RQSwUGAAAAAAMAAwDEAAAAJAEAAAAA';
const IPA_FIXTURE_SOURCE_PATH = path.join(__dirname, 'fixtures/SmallestAppExample.ipa');

async function writeIpaFileAsync(filePath: string, base64Data: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, base64Data, { encoding: 'base64' });
}

describe(readIpaInfoAsync, () => {
  it('reads bundle identifier and versions from fixture ipa', async () => {
    await expect(readIpaInfoAsync(IPA_FIXTURE_SOURCE_PATH)).resolves.toEqual({
      appName: 'SmallestAppExample',
      bundleIdentifier: 'dev.expo.SmallestAppExample',
      bundleShortVersion: '1.0',
      bundleVersion: '1',
      dtPlatformName: 'iphoneos',
    });
  });

  it('names an app without name keys after its bundle in the IPA', async () => {
    const ipaPath = '/tmp/no-name-keys.ipa';
    await writeIpaFileAsync(ipaPath, NO_NAME_KEYS_IPA_BASE64);

    await expect(readIpaInfoAsync(ipaPath)).resolves.toMatchObject({ appName: 'TestApp' });
  });

  it('throws when Info.plist cannot be found in IPA', async () => {
    const ipaPath = '/tmp/no-info.ipa';
    await writeIpaFileAsync(ipaPath, NO_INFO_PLIST_IPA_BASE64);

    await expect(readIpaInfoAsync(ipaPath)).rejects.toThrow(
      `Failed to read IPA info: Could not find Info.plist in ${ipaPath}`
    );
  });

  it('throws when required plist fields are missing', async () => {
    const ipaPath = '/tmp/missing-bundle-version.ipa';
    await writeIpaFileAsync(ipaPath, MISSING_BUNDLE_VERSION_IPA_BASE64);

    await expect(readIpaInfoAsync(ipaPath)).rejects.toThrow(
      /Failed to read IPA info: .*CFBundleVersion/
    );
  });
});

describe(readAppName, () => {
  it.each([
    [{ CFBundleDisplayName: 'Display', CFBundleName: 'Bundle' }, 'Display'],
    [{ CFBundleName: 'Bundle' }, 'Bundle'],
    [{ CFBundleDisplayName: '', CFBundleName: 'Bundle' }, 'Bundle'],
    [{ CFBundleDisplayName: '', CFBundleName: '' }, 'Example'],
    [{}, 'Example'],
  ])('reads the name of an app with %j as %s', (infoPlist, expectedName) => {
    expect(readAppName(infoPlist, '/build/Example.app')).toBe(expectedName);
  });
});

describe(createReadIpaInfoBuildFunction, () => {
  it('sets build step outputs', async () => {
    const readIpaInfo = createReadIpaInfoBuildFunction();
    const globalContext = createGlobalContextMock({
      staticContextContent: {
        job: {},
      },
    });

    const buildStep = readIpaInfo.createBuildStepFromFunctionCall(globalContext, {
      callInputs: {
        ipa_path: IPA_FIXTURE_SOURCE_PATH,
      },
    });
    await buildStep.executeAsync();

    expect(buildStep.outputById.bundle_identifier.value).toBe('dev.expo.SmallestAppExample');
    expect(buildStep.outputById.bundle_short_version.value).toBe('1.0');
    expect(buildStep.outputById.bundle_version.value).toBe('1');
  });
});
