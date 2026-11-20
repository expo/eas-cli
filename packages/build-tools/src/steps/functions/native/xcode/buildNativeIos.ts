import { UserError } from '@expo/eas-build-job';
import { bunyan } from '@expo/logger';
import {
  BuildFunction,
  BuildStepInput,
  BuildStepInputValueTypeName,
  BuildStepOutput,
} from '@expo/steps';
import { templateString } from '@expo/template-file';
import fg from 'fast-glob';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { GymfileArchiveTemplate } from '../../../../templates/GymfileArchive';
import { GymfileSimulatorTemplate } from '../../../../templates/GymfileSimulator';
import { InstalledIosCredentialsZ } from '../../../utils/ios/credentials/installedCredentials';
import { DistributionType } from '../../../utils/ios/credentials/provisioningProfile';
import { runFastlaneGym } from '../../../utils/ios/fastlane';
import { XcodeTargetsWithBundleIdentifierZ } from '../../../utils/ios/xcodeProject/pbxproj';
import { isWorkspace } from '../../../utils/ios/xcodeProject/projectFile';
import { parseInfoPlistBuffer } from '../../readIpaInfo';

const STEP_NAME = 'Build with Xcode';

interface ExportOptions {
  keychainPath: string;
  distributionType: DistributionType;
  provisioningProfileUuidByBundleIdentifier: Record<string, string>;
  iCloudContainerEnvironment?: string;
}

export function createBuildNativeIosBuildFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'build_native_ios',
    name: STEP_NAME,
    __metricsId: 'eas/build_native_ios',
    inputProviders: [
      BuildStepInput.createProvider({
        id: 'project_file',
        required: true,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      BuildStepInput.createProvider({
        id: 'scheme',
        required: true,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      BuildStepInput.createProvider({
        id: 'build_configuration',
        required: true,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      BuildStepInput.createProvider({
        id: 'targets',
        required: true,
        allowedValueTypeName: BuildStepInputValueTypeName.JSON,
      }),
      BuildStepInput.createProvider({
        id: 'installed_credentials',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.JSON,
      }),
      BuildStepInput.createProvider({
        id: 'entitlements_path',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
    ],
    outputProviders: [BuildStepOutput.createProvider({ id: 'archive_path', required: true })],
    fn: async (stepsCtx, { inputs, outputs, env }) => {
      const projectFilePath = inputs.project_file.value as string;
      const scheme = inputs.scheme.value as string;
      const buildConfiguration = inputs.build_configuration.value as string;
      const [applicationTarget] = XcodeTargetsWithBundleIdentifierZ.parse(inputs.targets.value);

      const exportOptions =
        inputs.installed_credentials.value === undefined
          ? undefined
          : await resolveExportOptionsAsync(stepsCtx.logger, {
              installedCredentials: inputs.installed_credentials.value,
              applicationTargetName: applicationTarget.name,
              entitlementsPath: inputs.entitlements_path.value as string | undefined,
            });

      const buildDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'native-ios-build-'));
      const derivedDataPath = path.join(buildDirectory, 'derived-data');
      const outputDirectory = path.join(buildDirectory, 'output');
      await fs.promises.writeFile(
        path.join(buildDirectory, 'Gymfile'),
        createGymfile({
          projectFilePath,
          scheme,
          buildConfiguration,
          derivedDataPath,
          outputDirectory,
          resultBundlePath: path.join(buildDirectory, 'build.xcresult'),
          logsDirectory: stepsCtx.global.buildLogsDirectory,
          exportOptions,
        })
      );
      await fs.promises.mkdir(stepsCtx.global.buildLogsDirectory, { recursive: true });
      try {
        await runFastlaneGym({
          workingDir: stepsCtx.workingDirectory,
          gymfileDirectory: buildDirectory,
          logger: stepsCtx.logger,
          buildLogsDirectory: stepsCtx.global.buildLogsDirectory,
          env,
        });
      } catch (err) {
        throw new UserError(
          'NATIVE_XCODE_BUILD_FAILED',
          `The Xcode build failed. The errors are in the "${STEP_NAME}" step. Refer to "Xcode Logs" below for additional, more detailed logs.`,
          { cause: err }
        );
      }

      const archivePath = exportOptions
        ? (await fg('*.ipa', { cwd: outputDirectory, absolute: true }))[0]
        : await findSimulatorAppAsync(derivedDataPath, applicationTarget.bundleIdentifier);
      if (!archivePath) {
        throw new UserError(
          'NATIVE_XCODE_NO_BUILD_OUTPUT',
          exportOptions
            ? `The build finished, but EAS found no ".ipa" in "${outputDirectory}". Check the Xcode logs for an export error.`
            : `The build finished, but EAS found no ".app" with the bundle identifier "${applicationTarget.bundleIdentifier}" in "${derivedDataPath}/Build/Products". Check in the Xcode logs which products the scheme "${scheme}" built.`
        );
      }
      outputs.archive_path.set(archivePath);
    },
  });
}

async function resolveExportOptionsAsync(
  logger: bunyan,
  {
    installedCredentials,
    applicationTargetName,
    entitlementsPath,
  }: { installedCredentials: unknown; applicationTargetName: string; entitlementsPath?: string }
): Promise<ExportOptions> {
  const { keychainPath, distributionType, profileByTargetName } =
    InstalledIosCredentialsZ.parse(installedCredentials);
  return {
    keychainPath,
    distributionType,
    provisioningProfileUuidByBundleIdentifier: Object.fromEntries(
      Object.values(profileByTargetName).map(({ bundleIdentifier, profileUuid }) => [
        bundleIdentifier,
        profileUuid,
      ])
    ),
    iCloudContainerEnvironment: entitlementsPath
      ? await readICloudContainerEnvironmentAsync(logger, {
          targetName: applicationTargetName,
          entitlementsPath,
        })
      : undefined,
  };
}

async function readICloudContainerEnvironmentAsync(
  logger: bunyan,
  { targetName, entitlementsPath }: { targetName: string; entitlementsPath: string }
): Promise<string | undefined> {
  let environment: unknown;
  try {
    const entitlements = parseInfoPlistBuffer(await fs.promises.readFile(entitlementsPath));
    environment = entitlements['com.apple.developer.icloud-container-environment'];
  } catch (err) {
    logger.warn(
      { err },
      `EAS could not read the entitlements file "${entitlementsPath}" of the target "${targetName}", so the export does not set an iCloud container environment. If the app uses CloudKit, check that CODE_SIGN_ENTITLEMENTS points to a property list file in the repository.`
    );
    return undefined;
  }
  if (typeof environment !== 'string' || environment === '') {
    return undefined;
  }
  logger.info(
    `Exporting with the iCloud container environment "${environment}" from "${path.basename(entitlementsPath)}".`
  );
  return environment;
}

function createGymfile({
  projectFilePath,
  scheme,
  buildConfiguration,
  derivedDataPath,
  outputDirectory,
  resultBundlePath,
  logsDirectory,
  exportOptions,
}: {
  projectFilePath: string;
  scheme: string;
  buildConfiguration: string;
  derivedDataPath: string;
  outputDirectory: string;
  resultBundlePath: string;
  logsDirectory: string;
  exportOptions?: ExportOptions;
}): string {
  const sharedVars = {
    SCHEME: scheme,
    SCHEME_BUILD_CONFIGURATION: buildConfiguration,
    DERIVED_DATA_PATH: derivedDataPath,
    RESULT_BUNDLE_PATH: resultBundlePath,
    CLEAN: 'false',
    LOGS_DIRECTORY: logsDirectory,
  };
  return [
    `${isWorkspace(projectFilePath) ? 'workspace' : 'project'}(${JSON.stringify(projectFilePath)})`,
    // xcodebuild refuses Swift package plugins and macros until someone approves them in the Xcode UI.
    'xcargs("-skipPackagePluginValidation -skipMacroValidation")',
    exportOptions
      ? templateString({
          input: GymfileArchiveTemplate,
          vars: {
            ...sharedVars,
            OUTPUT_DIRECTORY: outputDirectory,
            KEYCHAIN_PATH: exportOptions.keychainPath,
            EXPORT_METHOD: exportOptions.distributionType,
            PROFILES: Object.entries(exportOptions.provisioningProfileUuidByBundleIdentifier).map(
              ([bundleIdentifier, uuid]) => ({ BUNDLE_ID: bundleIdentifier, UUID: uuid })
            ),
            ICLOUD_CONTAINER_ENVIRONMENT: exportOptions.iCloudContainerEnvironment,
          },
          mustache: false,
        })
      : templateString({
          input: GymfileSimulatorTemplate,
          vars: {
            ...sharedVars,
            SCHEME_SIMULATOR_DESTINATION: 'generic/platform=iOS Simulator',
          },
          mustache: false,
        }),
  ].join('\n');
}

async function findSimulatorAppAsync(
  derivedDataPath: string,
  bundleIdentifier: string
): Promise<string | undefined> {
  const appPaths = await fg('Build/Products/*-iphonesimulator/*.app', {
    cwd: derivedDataPath,
    onlyDirectories: true,
    absolute: true,
  });
  for (const appPath of appPaths) {
    const infoPlist = parseInfoPlistBuffer(
      await fs.promises.readFile(path.join(appPath, 'Info.plist'))
    );
    if (infoPlist.CFBundleIdentifier === bundleIdentifier) {
      return appPath;
    }
  }
  return undefined;
}
