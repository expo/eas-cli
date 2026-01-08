import assert from 'assert';
import path from 'path';

import fs from 'fs-extra';
import { BuildFunction, BuildStepInput, BuildStepInputValueTypeName } from '@expo/steps';
import { Ios } from '@expo/eas-build-job';
import { IOSConfig } from '@expo/config-plugins';
import plist from '@expo/plist';
import { bunyan } from '@expo/logger';
import { templateString } from '@expo/template-file';

import { IosBuildCredentialsSchema } from '../utils/ios/credentials/credentials';
import IosCredentialsManager, { Credentials } from '../utils/ios/credentials/manager';
import { resolveBuildConfiguration, resolveScheme } from '../utils/ios/resolve';
import { isTVOS } from '../utils/ios/tvos';

const DEFAULT_CREDENTIALS_TEMPLATE = `
    suppress_xcode_output(true)
    clean(<%- CLEAN %>)

    scheme("<%- SCHEME %>")
    <% if (BUILD_CONFIGURATION) { %>
    configuration("<%- BUILD_CONFIGURATION %>")
    <% } %>

    export_options({
    method: "<%- EXPORT_METHOD %>",
    provisioningProfiles: {<% _.forEach(PROFILES, function(profile) { %>
        "<%- profile.BUNDLE_ID %>" => "<%- profile.UUID %>",<% }); %>
    }<% if (ICLOUD_CONTAINER_ENVIRONMENT) { %>,
    iCloudContainerEnvironment: "<%- ICLOUD_CONTAINER_ENVIRONMENT %>"
    <% } %>
    })

    export_xcargs "OTHER_CODE_SIGN_FLAGS=\\"--keychain <%- KEYCHAIN_PATH %>\\""

    disable_xcpretty(true)
    buildlog_path("<%- LOGS_DIRECTORY %>")

    output_directory("<%- OUTPUT_DIRECTORY %>")
`;

const DEFAULT_SIMULATOR_TEMPLATE = `
    suppress_xcode_output(true)
    clean(<%- CLEAN %>)

    scheme("<%- SCHEME %>")
    <% if (BUILD_CONFIGURATION) { %>
    configuration("<%- BUILD_CONFIGURATION %>")
    <% } %>

    derived_data_path("<%- DERIVED_DATA_PATH %>")
    skip_package_ipa(true)
    skip_archive(true)
    destination("<%- SCHEME_SIMULATOR_DESTINATION %>")

    disable_xcpretty(true)
    buildlog_path("<%- LOGS_DIRECTORY %>")
`;

export function generateGymfileFromTemplateFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'generate_gymfile_from_template',
    name: 'Generate Gymfile from template',
    __metricsId: 'eas/generate_gymfile_from_template',
    inputProviders: [
      BuildStepInput.createProvider({
        id: 'template',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      BuildStepInput.createProvider({
        id: 'credentials',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.JSON,
      }),
      BuildStepInput.createProvider({
        id: 'build_configuration',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      BuildStepInput.createProvider({
        id: 'scheme',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      BuildStepInput.createProvider({
        id: 'clean',
        required: true,
        allowedValueTypeName: BuildStepInputValueTypeName.BOOLEAN,
        defaultValue: false,
      }),
      BuildStepInput.createProvider({
        id: 'extra',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.JSON,
      }),
    ],
    fn: async (stepCtx, { inputs }) => {
      let credentials: Credentials | undefined = undefined;
      const rawCredentialsInput = inputs.credentials.value as Record<string, any> | undefined;
      if (rawCredentialsInput) {
        const { value, error } = IosBuildCredentialsSchema.validate(rawCredentialsInput, {
          stripUnknown: true,
          convert: true,
          abortEarly: false,
        });
        if (error) {
          throw error;
        }

        const credentialsManager = new IosCredentialsManager(value);
        credentials = await credentialsManager.prepare(stepCtx.logger);
      }

      const extra: Record<string, any> =
        (inputs.extra.value as Record<string, any> | undefined) ?? {};

      const templateInput = inputs.template.value as string | undefined;

      let template: string;
      if (templateInput) {
        template = templateInput;
      } else if (credentials) {
        template = DEFAULT_CREDENTIALS_TEMPLATE;
      } else {
        template = DEFAULT_SIMULATOR_TEMPLATE;
      }

      assert(stepCtx.global.staticContext.job, 'Job is not defined');
      const job = stepCtx.global.staticContext.job as Ios.Job;
      const buildConfiguration = resolveBuildConfiguration(
        job,
        inputs.build_configuration.value as string | undefined
      );
      const scheme = resolveScheme(
        stepCtx.workingDirectory,
        job,
        inputs.scheme.value as string | undefined
      );
      const entitlements = await maybeReadEntitlementsAsync(
        stepCtx.logger,
        stepCtx.workingDirectory,
        scheme,
        buildConfiguration
      );

      const gymfilePath = path.join(stepCtx.workingDirectory, 'ios/Gymfile');

      const PROFILES: { BUNDLE_ID: string; UUID: string }[] = [];
      if (credentials) {
        const targets = Object.keys(credentials.targetProvisioningProfiles);
        for (const target of targets) {
          const profile = credentials.targetProvisioningProfiles[target];
          PROFILES.push({
            BUNDLE_ID: profile.bundleIdentifier,
            UUID: profile.uuid,
          });
        }
      }

      const ICLOUD_CONTAINER_ENVIRONMENT = (
        entitlements as Record<string, string | Record<string, string>>
      )?.['com.apple.developer.icloud-container-environment'] as string | undefined;

      const isTV = await isTVOS({
        scheme,
        buildConfiguration,
        workingDir: stepCtx.workingDirectory,
      });
      const simulatorDestination = `generic/platform=${isTV ? 'tvOS' : 'iOS'} Simulator`;

      const output = templateString({
        input: template,
        vars: {
          SCHEME: scheme,
          BUILD_CONFIGURATION: buildConfiguration,
          OUTPUT_DIRECTORY: './build',
          CLEAN: String(inputs.clean.value),
          LOGS_DIRECTORY: stepCtx.global.buildLogsDirectory,
          ICLOUD_CONTAINER_ENVIRONMENT,
          SCHEME_SIMULATOR_DESTINATION: simulatorDestination,
          DERIVED_DATA_PATH: './build',
          ...(PROFILES ? { PROFILES } : {}),
          ...(credentials
            ? {
                KEYCHAIN_PATH: credentials.keychainPath,
                EXPORT_METHOD: credentials.distributionType,
              }
            : {}),
          ...extra,
        },
        mustache: false,
      });
      await fs.writeFile(gymfilePath, output);

      const gymfileContents = await fs.readFile(gymfilePath, 'utf8');
      stepCtx.logger.info(`Successfully generated Gymfile: ${gymfileContents}`);
    },
  });
}

async function maybeReadEntitlementsAsync(
  logger: bunyan,
  workingDir: string,
  scheme: string,
  buildConfiguration: string
): Promise<object | null> {
  try {
    const applicationTargetName =
      await IOSConfig.BuildScheme.getApplicationTargetNameForSchemeAsync(workingDir, scheme);
    const entitlementsPath = IOSConfig.Entitlements.getEntitlementsPath(workingDir, {
      buildConfiguration,
      targetName: applicationTargetName,
    });
    if (!entitlementsPath) {
      return null;
    }
    const entitlementsRaw = await fs.readFile(entitlementsPath, 'utf8');
    return plist.parse(entitlementsRaw);
  } catch (err) {
    logger.warn({ err }, 'Failed to read entitlements');
    return null;
  }
}
