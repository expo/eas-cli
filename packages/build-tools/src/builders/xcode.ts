import { Ios, Step, SystemError } from '@expo/eas-build-job';
import {
  BuildStepGlobalContext,
  BuildWorkflow,
  StepsConfigParser,
  createLocalCompositeFunctionLoader,
  errors,
} from '@expo/steps';
import path from 'node:path';

import { prepareProjectForStepsAsync } from './prepareProjectForSteps';
import { Artifacts, BuildContext } from '../context';
import { CustomBuildContext } from '../customBuildContext';
import { findAndUploadXcodeBuildLogsAsync } from '../ios/xcodeBuildLogs';
import { getEasFunctions } from '../steps/easFunctions';
import { createIncrementRemoteBuildNumberBuildFunction } from '../steps/functions/native/incrementRemoteBuildNumber';
import { createPrepareIosCredentialsBuildFunction } from '../steps/functions/native/prepareIosCredentials';
import { createUpdateRemoteBuildMetadataBuildFunction } from '../steps/functions/native/updateRemoteBuildMetadata';
import { createBuildNativeIosBuildFunction } from '../steps/functions/native/xcode/buildNativeIos';
import { createConfigureXcodeSigningBuildFunction } from '../steps/functions/native/xcode/configureXcodeSigning';
import { createDetectNativeXcodeBuildFunction } from '../steps/functions/native/xcode/detectNativeXcode';
import { createInstallNativePodsBuildFunction } from '../steps/functions/native/xcode/installNativePods';
import { createSetNativeXcodeBuildNumberBuildFunction } from '../steps/functions/native/xcode/setNativeXcodeBuildNumber';
import { createVerifyNativeIosBuildFunction } from '../steps/functions/native/xcode/verifyNativeIos';

export async function runXcodeBuildAsync(ctx: BuildContext<Ios.Job>): Promise<Artifacts> {
  validateXcodeJob(ctx.job);

  const customBuildCtx = new CustomBuildContext(ctx);
  await prepareProjectForStepsAsync(ctx, customBuildCtx.projectSourceDirectory);
  const globalContext = new BuildStepGlobalContext(customBuildCtx, /* skipCleanup */ false);
  let workflow: BuildWorkflow;
  try {
    workflow = await createXcodeWorkflowAsync(globalContext, customBuildCtx);
  } catch (parseError) {
    if (parseError instanceof errors.BuildWorkflowError) {
      for (const err of parseError.errors) {
        ctx.logger.error({ err });
      }
    }
    throw parseError;
  }
  try {
    await workflow.executeAsync();
  } catch (err: any) {
    err.artifacts = ctx.artifacts;
    throw err;
  } finally {
    await findAndUploadXcodeBuildLogsAsync(ctx, { logger: ctx.logger });
    await customBuildCtx.drainPendingMetricUploads();
  }
  return ctx.artifacts;
}

export function validateXcodeJob(job: Ios.Job): void {
  const { error } = Ios.JobSchema.validate(job, {
    allowUnknown: true,
    convert: false,
    abortEarly: false,
  });
  if (error) {
    throw new SystemError(
      `EAS created an Xcode build job that is not valid: ${error.message}. Your project did not cause this. Run the build again, and contact Expo support if it keeps failing.`,
      { trackingCode: 'NATIVE_INVALID_JOB' }
    );
  }
}

export async function createXcodeWorkflowAsync(
  globalContext: BuildStepGlobalContext,
  customBuildCtx: CustomBuildContext<Ios.Job>
): Promise<BuildWorkflow> {
  const { job } = customBuildCtx;
  const steps: Step[] = [
    { uses: 'eas/checkout' },
    { uses: 'eas/install_native_pods', working_directory: job.projectDirectory },
    {
      id: 'detect_native_xcode',
      uses: 'eas/detect_native_xcode',
      working_directory: job.projectDirectory,
      with: {
        project_file: job.projectFile,
        scheme: job.scheme,
        build_configuration: job.buildConfiguration,
        expected_identifier: job.appIdentifier,
        read_version: job.autoIncrement,
      },
    },
    ...(job.simulator
      ? []
      : [
          {
            id: 'prepare_ios_credentials',
            uses: 'eas/prepare_ios_credentials',
            with: {
              targets: '${{ steps.detect_native_xcode.outputs.targets }}',
              distribution: job.distribution,
              enterprise_provisioning: job.enterpriseProvisioning,
            },
          },
        ]),
    ...(job.autoIncrement
      ? [
          {
            id: 'increment_remote_build_number',
            uses: 'eas/increment_remote_build_number',
            with: {
              application_identifier:
                '${{ steps.detect_native_xcode.outputs.application_identifier }}',
              current_build_number: '${{ steps.detect_native_xcode.outputs.build_number }}',
              app_version: '${{ steps.detect_native_xcode.outputs.app_version }}',
            },
          },
          {
            uses: 'eas/set_native_xcode_build_number',
            with: {
              xcodeproj_path: '${{ steps.detect_native_xcode.outputs.xcodeproj_path }}',
              build_configuration: '${{ steps.detect_native_xcode.outputs.build_configuration }}',
              targets: '${{ steps.detect_native_xcode.outputs.targets }}',
              editable_info_plist_paths:
                '${{ steps.detect_native_xcode.outputs.editable_info_plist_paths }}',
              build_number: '${{ steps.increment_remote_build_number.outputs.build_number }}',
            },
          },
        ]
      : []),
    ...(job.simulator
      ? []
      : [
          {
            id: 'configure_xcode_signing',
            uses: 'eas/configure_xcode_signing',
            with: {
              xcodeproj_path: '${{ steps.detect_native_xcode.outputs.xcodeproj_path }}',
              build_configuration: '${{ steps.detect_native_xcode.outputs.build_configuration }}',
              targets: '${{ steps.detect_native_xcode.outputs.targets }}',
              installed_credentials:
                '${{ steps.prepare_ios_credentials.outputs.installed_credentials }}',
            },
          },
        ]),
    {
      id: 'build_native_ios',
      uses: 'eas/build_native_ios',
      working_directory: job.projectDirectory,
      with: {
        project_file: '${{ steps.detect_native_xcode.outputs.project_file }}',
        scheme: '${{ steps.detect_native_xcode.outputs.scheme }}',
        build_configuration: '${{ steps.detect_native_xcode.outputs.build_configuration }}',
        targets: '${{ steps.detect_native_xcode.outputs.targets }}',
        ...(job.simulator
          ? {}
          : {
              installed_credentials:
                '${{ steps.prepare_ios_credentials.outputs.installed_credentials }}',
              entitlements_path: '${{ steps.configure_xcode_signing.outputs.entitlements_path }}',
            }),
      },
    },
    {
      id: 'verify_native_ios',
      uses: 'eas/verify_native_ios',
      with: {
        archive_path: '${{ steps.build_native_ios.outputs.archive_path }}',
        expected_identifier: job.appIdentifier,
        expected_build_number: job.autoIncrement
          ? '${{ steps.increment_remote_build_number.outputs.build_number }}'
          : undefined,
      },
    },
    {
      uses: 'eas/update_remote_build_metadata',
      with: {
        app_name: '${{ steps.verify_native_ios.outputs.app_name }}',
        application_identifier: '${{ steps.verify_native_ios.outputs.application_identifier }}',
        app_version: '${{ steps.verify_native_ios.outputs.app_version }}',
        build_number: '${{ steps.verify_native_ios.outputs.build_number }}',
      },
    },
    {
      uses: 'eas/upload_artifact',
      with: {
        type: 'application-archive',
        path: '${{ steps.build_native_ios.outputs.archive_path }}',
      },
    },
  ];

  return await new StepsConfigParser(globalContext, {
    steps,
    hooks: job.hooks,
    externalFunctions: [
      ...getEasFunctions(customBuildCtx),
      createInstallNativePodsBuildFunction(),
      createDetectNativeXcodeBuildFunction(),
      createPrepareIosCredentialsBuildFunction(customBuildCtx),
      createIncrementRemoteBuildNumberBuildFunction(customBuildCtx),
      createSetNativeXcodeBuildNumberBuildFunction(),
      createConfigureXcodeSigningBuildFunction(),
      createBuildNativeIosBuildFunction(),
      createVerifyNativeIosBuildFunction(),
      createUpdateRemoteBuildMetadataBuildFunction(customBuildCtx),
    ],
    loadCompositeFunction: createLocalCompositeFunctionLoader(
      path.join(customBuildCtx.projectSourceDirectory, job.projectRootDirectory ?? '.'),
      { logger: customBuildCtx.logger }
    ),
  }).parseAsync();
}
