import fs from 'node:fs';
import path from 'node:path';

import { createGlobalContextMock } from '../../../__tests__/utils/context';
import { createReadIpaInfoBuildFunction, readIpaInfoAsync } from '../readIpaInfo';

const VALID_IPA_BASE64 =
  'UEsDBAoAAAAAAPFcUFwAAAAAAAAAAAAAAAAIABwAUGF5bG9hZC9VVAkAA+Xzkmnl85JpdXgLAAEE9QEAAAQUAAAAUEsDBAoAAAAAAPFcUFwAAAAAAAAAAAAAAAAUABwAUGF5bG9hZC9UZXN0QXBwLmFwcC9VVAkAA+Xzkmnl85JpdXgLAAEE9QEAAAQUAAAAUEsDBBQAAAAIAPFcUFw8acyt5gAAAHcBAAAeABwAUGF5bG9hZC9UZXN0QXBwLmFwcC9JbmZvLnBsaXN0VVQJAAPl85Jp5fOSaXV4CwABBPUBAAAEFAAAAHWP0UrDMBSG7/sUMffNcdMLkSzDtRsUihbaCV6OJrpgm5TkaLe3N1kH4oa35/z/953Dl4e+I9/KeW3Ngs7YLSXKtFZq87Gg22aTPtClSPhN/pI1b9WaDJ32SKrtqiwyQlOAp2HoFEDe5KQqi7ohgQGwfqaE7hGHR4BxHNkuplhr+xj0UDk7KIfHMsDSUGASJQ2aif7nnDCVukWREMI/1VFkm9WXkZ0qpDKo37VyHOI87j26cLcIGqYOuz4qUXkMcg7n3SWm3luHr5OwPkWucDM2Z3f/As7dq9b9/LfCYXqBw+lBkfwAUEsBAh4DCgAAAAAA8VxQXAAAAAAAAAAAAAAAAAgAGAAAAAAAAAAQAO1BAAAAAFBheWxvYWQvVVQFAAPl85JpdXgLAAEE9QEAAAQUAAAAUEsBAh4DCgAAAAAA8VxQXAAAAAAAAAAAAAAAABQAGAAAAAAAAAAQAO1BQgAAAFBheWxvYWQvVGVzdEFwcC5hcHAvVVQFAAPl85JpdXgLAAEE9QEAAAQUAAAAUEsBAh4DFAAAAAgA8VxQXDxpzK3mAAAAdwEAAB4AGAAAAAAAAQAAAKSBkAAAAFBheWxvYWQvVGVzdEFwcC5hcHAvSW5mby5wbGlzdFVUBQAD5fOSaXV4CwABBPUBAAAEFAAAAFBLBQYAAAAAAwADAAwBAADOAQAAAAA=';
const NO_INFO_PLIST_IPA_BASE64 =
  'UEsDBAoAAAAAAPRcUFwAAAAAAAAAAAAAAAAIABwAUGF5bG9hZC9VVAkAA+zzkmns85JpdXgLAAEE9QEAAAQUAAAAUEsDBAoAAAAAAPRcUFwAAAAAAAAAAAAAAAAUABwAUGF5bG9hZC9UZXN0QXBwLmFwcC9VVAkAA+zzkmns85JpdXgLAAEE9QEAAAQUAAAAUEsDBAoAAAAAAPRcUFwgMDo2BgAAAAYAAAAeABwAUGF5bG9hZC9UZXN0QXBwLmFwcC9SZWFkbWUudHh0VVQJAAPs85Jp7POSaXV4CwABBPUBAAAEFAAAAGhlbGxvClBLAQIeAwoAAAAAAPRcUFwAAAAAAAAAAAAAAAAIABgAAAAAAAAAEADtQQAAAABQYXlsb2FkL1VUBQAD7POSaXV4CwABBPUBAAAEFAAAAFBLAQIeAwoAAAAAAPRcUFwAAAAAAAAAAAAAAAAUABgAAAAAAAAAEADtQUIAAABQYXlsb2FkL1Rlc3RBcHAuYXBwL1VUBQAD7POSaXV4CwABBPUBAAAEFAAAAFBLAQIeAwoAAAAAAPRcUFwgMDo2BgAAAAYAAAAeABgAAAAAAAEAAACkgZAAAABQYXlsb2FkL1Rlc3RBcHAuYXBwL1JlYWRtZS50eHRVVAUAA+zzkml1eAsAAQT1AQAABBQAAABQSwUGAAAAAAMAAwAMAQAA7gAAAAAA';
const MISSING_BUNDLE_VERSION_IPA_BASE64 =
  'UEsDBAoAAAAAAPRcUFwAAAAAAAAAAAAAAAAIABwAUGF5bG9hZC9VVAkAA+zzkmns85JpdXgLAAEE9QEAAAQUAAAAUEsDBAoAAAAAAPRcUFwAAAAAAAAAAAAAAAAUABwAUGF5bG9hZC9UZXN0QXBwLmFwcC9VVAkAA+zzkmns85JpdXgLAAEE9QEAAAQUAAAAUEsDBBQAAAAIAPRcUFz9BfqM2wAAAEQBAAAeABwAUGF5bG9hZC9UZXN0QXBwLmFwcC9JbmZvLnBsaXN0VVQJAAPs85Jp7POSaXV4CwABBPUBAAAEFAAAAGWOUUvDMBSF3/srYt6b6/RFJMtw7QaFooV2go+jybZgm4Tkard/b7IKor7ec+73Hb46jwP5VD5oa5Z0wW4pUaa3Upvjku66bf5AVyLjN+VL0b01G+IGHZA0u3VdFYTmAE/ODQqg7ErS1FXbkcgA2DxTQk+I7hFgmia2Ty3W2zEVAzTeOuXxUkdYHh+YREmjZqb/mhOvUvcoMkL4u7qIYrv+MHJQlVQG9UErzyHdUx7Qx90iapg678ekRBUwyjl8Z38x7cl6fJ2F7bXyD7dgd+z+B8Bh3sPhulZkX1BLAQIeAwoAAAAAAPRcUFwAAAAAAAAAAAAAAAAIABgAAAAAAAAAEADtQQAAAABQYXlsb2FkL1VUBQAD7POSaXV4CwABBPUBAAAEFAAAAFBLAQIeAwoAAAAAAPRcUFwAAAAAAAAAAAAAAAAUABgAAAAAAAAAEADtQUIAAABQYXlsb2FkL1Rlc3RBcHAuYXBwL1VUBQAD7POSaXV4CwABBPUBAAAEFAAAAFBLAQIeAxQAAAAIAPRcUFz9BfqM2wAAAEQBAAAeABgAAAAAAAEAAACkgZAAAABQYXlsb2FkL1Rlc3RBcHAuYXBwL0luZm8ucGxpc3RVVAUAA+zzkml1eAsAAQT1AQAABBQAAABQSwUGAAAAAAMAAwAMAQAAwwEAAAAA';

async function writeIpaFileAsync(filePath: string, base64Data: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, base64Data, { encoding: 'base64' });
}

describe(readIpaInfoAsync, () => {
  it('reads bundle identifier and versions from an ipa', async () => {
    const ipaPath = '/tmp/test.ipa';
    await writeIpaFileAsync(ipaPath, VALID_IPA_BASE64);

    await expect(readIpaInfoAsync(ipaPath)).resolves.toEqual({
      bundleIdentifier: 'com.example.testapp',
      bundleShortVersion: '1.2.3',
      bundleVersion: '42',
    });
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

describe(createReadIpaInfoBuildFunction, () => {
  it('sets build step outputs', async () => {
    const readIpaInfo = createReadIpaInfoBuildFunction();
    const globalContext = createGlobalContextMock({
      staticContextContent: {
        job: {},
      },
    });
    const ipaPath = path.join(globalContext.defaultWorkingDirectory, 'builds/test.ipa');
    await writeIpaFileAsync(ipaPath, VALID_IPA_BASE64);

    const buildStep = readIpaInfo.createBuildStepFromFunctionCall(globalContext, {
      callInputs: {
        ipa_path: './builds/test.ipa',
      },
    });
    await buildStep.executeAsync();

    expect(buildStep.outputById.bundle_identifier.value).toBe('com.example.testapp');
    expect(buildStep.outputById.bundle_short_version.value).toBe('1.2.3');
    expect(buildStep.outputById.bundle_version.value).toBe('42');
  });
});
