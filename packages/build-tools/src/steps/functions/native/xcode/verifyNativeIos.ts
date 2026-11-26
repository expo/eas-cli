import { Ios, UserError } from '@expo/eas-build-job';
import {
  BuildFunction,
  BuildStepInput,
  BuildStepInputValueTypeName,
  BuildStepOutput,
} from '@expo/steps';
import fs from 'node:fs';
import path from 'node:path';

import { parseInfoPlistBuffer, readAppName, readIpaInfoAsync } from '../../readIpaInfo';

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
      BuildStepInput.createProvider({
        id: 'expected_build_number',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
    ],
    outputProviders: [
      BuildStepOutput.createProvider({ id: 'app_name', required: true }),
      BuildStepOutput.createProvider({ id: 'application_identifier', required: false }),
      BuildStepOutput.createProvider({ id: 'app_version', required: false }),
      BuildStepOutput.createProvider({ id: 'build_number', required: false }),
    ],
    fn: async (stepsCtx, { inputs, outputs }) => {
      const job = stepsCtx.global.staticContext.job as Ios.Job;
      const archivePath = inputs.archive_path.value as string;
      const expectedIdentifier = inputs.expected_identifier.value as string | undefined;
      const expectedBuildNumber = inputs.expected_build_number.value as string | undefined;
      const expectedPlatformName = job.simulator ? 'iphonesimulator' : 'iphoneos';

      const { appName, bundleIdentifier, platformName, version, buildNumber } =
        await readArtifactInfoAsync(archivePath);
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
      if (expectedBuildNumber && buildNumber !== expectedBuildNumber) {
        stepsCtx.logger.warn(
          `EAS set the build number to ${expectedBuildNumber}, but the built app has ${
            buildNumber ?? 'no build number'
          }. The build of the project does not use the number that EAS set; a build phase script or a preprocessed Info.plist file can cause this. To build with the number of the project, set "auto_increment: false".`
        );
      }
      stepsCtx.logger.info(
        `Verified "${path.basename(archivePath)}": ${bundleIdentifier}, built for ${platformName}.`
      );
      outputs.app_name.set(appName);
      outputs.application_identifier.set(bundleIdentifier);
      outputs.app_version.set(version);
      outputs.build_number.set(buildNumber);
    },
  });
}

async function readArtifactInfoAsync(archivePath: string): Promise<{
  appName: string;
  bundleIdentifier?: string;
  platformName?: string;
  version?: string;
  buildNumber?: string;
}> {
  if ((await fs.promises.stat(archivePath)).isDirectory()) {
    const infoPlist = parseInfoPlistBuffer(
      await fs.promises.readFile(path.join(archivePath, 'Info.plist'))
    );
    return {
      appName: readAppName(infoPlist, archivePath),
      bundleIdentifier: stringOrUndefined(infoPlist.CFBundleIdentifier),
      platformName: stringOrUndefined(infoPlist.DTPlatformName),
      version: stringOrUndefined(infoPlist.CFBundleShortVersionString),
      buildNumber: stringOrUndefined(infoPlist.CFBundleVersion),
    };
  }
  const { appName, bundleIdentifier, dtPlatformName, bundleShortVersion, bundleVersion } =
    await readIpaInfoAsync(archivePath);
  return {
    appName,
    bundleIdentifier,
    platformName: dtPlatformName ?? undefined,
    version: bundleShortVersion,
    buildNumber: bundleVersion,
  };
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
