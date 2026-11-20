import { Ios, UserError } from '@expo/eas-build-job';
import { BuildFunction, BuildStepInput, BuildStepInputValueTypeName } from '@expo/steps';
import fs from 'node:fs';
import path from 'node:path';

import { parseInfoPlistBuffer, readIpaInfoAsync } from '../../readIpaInfo';

export function createVerifyNativeIosBuildFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'verify_native_ios',
    name: 'Verify the build artifact',
    __metricsId: 'eas/verify_native_ios',
    inputProviders: [
      BuildStepInput.createProvider({
        id: 'archive_path',
        required: true,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      BuildStepInput.createProvider({
        id: 'expected_identifier',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
    ],
    fn: async (stepsCtx, { inputs }) => {
      const job = stepsCtx.global.staticContext.job as Ios.Job;
      const archivePath = inputs.archive_path.value as string;
      const expectedIdentifier = inputs.expected_identifier.value as string | undefined;
      const expectedPlatformName = job.simulator ? 'iphonesimulator' : 'iphoneos';

      const { bundleIdentifier, platformName } = await readArtifactInfoAsync(archivePath);
      if (platformName !== expectedPlatformName) {
        throw new UserError(
          'NATIVE_XCODE_ARTIFACT_PLATFORM_MISMATCH',
          `The build artifact "${path.basename(archivePath)}" was built for "${platformName}", but this build is for ${
            job.simulator ? 'the iOS simulator' : 'iOS devices'
          } and needs "${expectedPlatformName}". Check that the scheme builds an iOS app.`
        );
      }
      if (expectedIdentifier && bundleIdentifier !== expectedIdentifier) {
        throw new UserError(
          'NATIVE_XCODE_ARTIFACT_IDENTIFIER_MISMATCH',
          `The build artifact "${path.basename(archivePath)}" has the bundle identifier "${bundleIdentifier}", but "app_identifier" is "${expectedIdentifier}". Set "app_identifier" to "${bundleIdentifier}", or set "xcode_scheme" and "xcode_configuration" to the ones that build "${expectedIdentifier}".`
        );
      }
      stepsCtx.logger.info(
        `Verified "${path.basename(archivePath)}": ${bundleIdentifier}, built for ${platformName}.`
      );
    },
  });
}

async function readArtifactInfoAsync(
  archivePath: string
): Promise<{ bundleIdentifier: unknown; platformName: unknown }> {
  if ((await fs.promises.stat(archivePath)).isDirectory()) {
    const infoPlist = parseInfoPlistBuffer(
      await fs.promises.readFile(path.join(archivePath, 'Info.plist'))
    );
    return {
      bundleIdentifier: infoPlist.CFBundleIdentifier,
      platformName: infoPlist.DTPlatformName,
    };
  }
  const { bundleIdentifier, dtPlatformName } = await readIpaInfoAsync(archivePath);
  return { bundleIdentifier, platformName: dtPlatformName };
}
