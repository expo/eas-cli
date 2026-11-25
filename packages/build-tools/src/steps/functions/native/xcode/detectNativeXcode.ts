import { IOSConfig } from '@expo/config-plugins';
import { Ios, UserError } from '@expo/eas-build-job';
import {
  BuildFunction,
  BuildStepInput,
  BuildStepInputValueTypeName,
  BuildStepOutput,
} from '@expo/steps';
import path from 'node:path';
import { XcodeProject } from 'xcode';

import {
  readEditableInfoPlistsAsync,
  readProjectVersion,
} from '../../../utils/ios/xcodeProject/buildNumber';
import { readBuildSettingsByTargetNameAsync } from '../../../utils/ios/xcodeProject/buildSettings';
import {
  XcodeTarget,
  XcodeTargetWithBundleIdentifier,
  findApplicationTargetById,
  findDependencyTargets,
  getBuildConfigurations,
  openXcodeProject,
} from '../../../utils/ios/xcodeProject/pbxproj';
import { resolveProjectFilePathAsync } from '../../../utils/ios/xcodeProject/projectFile';
import {
  XcodeSchemeDetails,
  findSharedSchemesAsync,
  readSchemeAsync,
  selectScheme,
} from '../../../utils/ios/xcodeProject/schemes';

export function createDetectNativeXcodeBuildFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'detect_native_xcode',
    name: 'Detect Xcode project',
    __metricsId: 'eas/detect_native_xcode',
    inputProviders: [
      BuildStepInput.createProvider({
        id: 'project_file',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      BuildStepInput.createProvider({
        id: 'scheme',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      BuildStepInput.createProvider({
        id: 'build_configuration',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      BuildStepInput.createProvider({
        id: 'expected_identifier',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      BuildStepInput.createProvider({
        id: 'read_version',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.BOOLEAN,
      }),
    ],
    outputProviders: [
      BuildStepOutput.createProvider({ id: 'project_file', required: true }),
      BuildStepOutput.createProvider({ id: 'scheme', required: true }),
      BuildStepOutput.createProvider({ id: 'build_configuration', required: true }),
      BuildStepOutput.createProvider({ id: 'xcodeproj_path', required: true }),
      BuildStepOutput.createProvider({ id: 'targets', required: true }),
      BuildStepOutput.createProvider({ id: 'application_identifier', required: true }),
      BuildStepOutput.createProvider({ id: 'app_version', required: false }),
      BuildStepOutput.createProvider({ id: 'build_number', required: false }),
      BuildStepOutput.createProvider({ id: 'editable_info_plist_paths', required: false }),
    ],
    fn: async (stepsCtx, { inputs, outputs, env }) => {
      const { logger, workingDirectory } = stepsCtx;
      const job = stepsCtx.global.staticContext.job as Ios.Job;
      const needsSigning = !job.simulator;

      const projectFilePath = await resolveProjectFilePathAsync({
        projectDirectory: workingDirectory,
        baseDirectory: stepsCtx.global.defaultWorkingDirectory,
        repositoryDirectory: stepsCtx.global.projectTargetDirectory,
        projectFile: inputs.project_file.value as string | undefined,
      });
      const schemes = await findSharedSchemesAsync(projectFilePath);
      const scheme = selectScheme(schemes, {
        requestedName: inputs.scheme.value as string | undefined,
        logger,
      });
      const { applicationTargetReference, archiveConfiguration, launchConfiguration } =
        await readSchemeAsync(scheme);

      const application = openApplicationTarget(applicationTargetReference);
      if (!application) {
        const otherSchemeNames = schemes
          .map(({ name }) => name)
          .filter(name => name !== scheme.name);
        throw new UserError(
          'NATIVE_XCODE_NO_APPLICATION_TARGET',
          `The scheme "${scheme.name}" does not build an iOS application target, so EAS has no app to sign and upload. ${
            otherSchemeNames.length > 0
              ? `Other shared schemes: ${otherSchemeNames.sort().join(', ')}. Set "xcode_scheme" to the scheme of the app.`
              : 'Share the scheme of the app in Xcode (Product > Scheme > Manage Schemes) and commit its ".xcscheme" file.'
          }`
        );
      }
      const { project, xcodeprojPath, target: applicationTarget } = application;

      const buildConfiguration =
        (inputs.build_configuration.value as string | undefined) ??
        (needsSigning ? archiveConfiguration : launchConfiguration);
      const buildConfigurationNames = getBuildConfigurations(project, applicationTarget.id).map(
        ({ name }) => IOSConfig.XcodeUtils.unquote(name)
      );
      if (!buildConfiguration || !buildConfigurationNames.includes(buildConfiguration)) {
        throw new UserError(
          'NATIVE_XCODE_BUILD_CONFIGURATION_NOT_FOUND',
          `${
            buildConfiguration
              ? `The target "${applicationTarget.name}" has no build configuration named "${buildConfiguration}".`
              : `The scheme "${scheme.name}" names no build configuration for its ${needsSigning ? 'Archive' : 'Run'} action.`
          } Build configurations of the target: ${buildConfigurationNames.join(', ')}. Set "xcode_configuration" to one of them.`
        );
      }

      const dependencyTargets = needsSigning
        ? findDependencyTargets(project, applicationTarget.id)
        : [];
      const buildSettingsByTargetName = await readBuildSettingsByTargetNameAsync({
        xcodeprojPath,
        targetNames: [applicationTarget, ...dependencyTargets].map(({ name }) => name),
        buildConfiguration,
        sdk: job.simulator ? 'iphonesimulator' : undefined,
        env,
        logger,
      });
      const targets: XcodeTargetWithBundleIdentifier[] = [
        applicationTarget,
        // Xcode sets this on products that need a provisioning profile (DarwinProductTypes.xcspec).
        ...dependencyTargets.filter(
          ({ name }) => buildSettingsByTargetName[name]?.PROVISIONING_PROFILE_REQUIRED === 'YES'
        ),
      ].map(target => {
        const bundleIdentifier = buildSettingsByTargetName[target.name]?.PRODUCT_BUNDLE_IDENTIFIER;
        if (!bundleIdentifier) {
          throw new UserError(
            'NATIVE_XCODE_NO_BUNDLE_IDENTIFIER',
            `The target "${target.name}" has no bundle identifier in the build configuration "${buildConfiguration}". EAS finds the built app and picks the signing credentials by bundle identifier, for the application target and for every target it depends on that needs a provisioning profile. Set PRODUCT_BUNDLE_IDENTIFIER for this target in Xcode.`
          );
        }
        return { ...target, bundleIdentifier };
      });

      const expectedIdentifier = inputs.expected_identifier.value as string | undefined;
      const [{ bundleIdentifier: applicationIdentifier }] = targets;
      if (expectedIdentifier && applicationIdentifier !== expectedIdentifier) {
        throw new UserError(
          'NATIVE_XCODE_APP_IDENTIFIER_MISMATCH',
          `"app_identifier" is "${expectedIdentifier}", but the target "${applicationTarget.name}" has the bundle identifier "${applicationIdentifier}" in the build configuration "${buildConfiguration}". Set "app_identifier" to "${applicationIdentifier}", or set "xcode_scheme" and "xcode_configuration" to the ones that build "${expectedIdentifier}".`
        );
      }

      logger.info(
        `Building the scheme "${scheme.name}" of "${path.basename(projectFilePath)}" with the build configuration "${buildConfiguration}".`
      );
      for (const { name, bundleIdentifier } of targets) {
        logger.info(`Target "${name}": ${bundleIdentifier}`);
      }

      outputs.project_file.set(projectFilePath);
      outputs.scheme.set(scheme.name);
      outputs.build_configuration.set(buildConfiguration);
      outputs.xcodeproj_path.set(xcodeprojPath);
      outputs.targets.set(JSON.stringify(targets));
      outputs.application_identifier.set(applicationIdentifier);

      if (inputs.read_version.value) {
        const editableInfoPlistByPath = await readEditableInfoPlistsAsync(
          targets.map(({ name }) => buildSettingsByTargetName[name]),
          { env, logger }
        );
        const { shortVersion, buildNumber } = readProjectVersion(
          buildSettingsByTargetName[applicationTarget.name],
          editableInfoPlistByPath
        );
        logger.info(`Version: ${shortVersion ?? 'none'}. Build number: ${buildNumber ?? 'none'}.`);
        outputs.app_version.set(shortVersion);
        outputs.build_number.set(buildNumber);
        outputs.editable_info_plist_paths.set(JSON.stringify([...editableInfoPlistByPath.keys()]));
      }
    },
  });
}

function openApplicationTarget(
  reference: XcodeSchemeDetails['applicationTargetReference']
): { project: XcodeProject; xcodeprojPath: string; target: XcodeTarget } | undefined {
  if (!reference) {
    return undefined;
  }
  const project = openXcodeProject(reference.xcodeprojPath);
  const target = findApplicationTargetById(project, reference.targetId);
  return target && { project, xcodeprojPath: reference.xcodeprojPath, target };
}
