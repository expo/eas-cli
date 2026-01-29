import { BuildJob, Platform } from '@expo/eas-build-job';
import { BuildFunctionGroup, BuildStep, BuildStepGlobalContext } from '@expo/steps';

import { shouldUseEagerBundle } from '../../common/eagerBundle';
import { CustomBuildContext } from '../../customBuildContext';
import { calculateEASUpdateRuntimeVersionFunction } from '../functions/calculateEASUpdateRuntimeVersion';
import { createCheckoutBuildFunction } from '../functions/checkout';
import { configureAndroidVersionFunction } from '../functions/configureAndroidVersion';
import { configureEASUpdateIfInstalledFunction } from '../functions/configureEASUpdateIfInstalled';
import { configureIosCredentialsFunction } from '../functions/configureIosCredentials';
import { configureIosVersionFunction } from '../functions/configureIosVersion';
import { eagerBundleBuildFunction } from '../functions/eagerBundle';
import { createFindAndUploadBuildArtifactsBuildFunction } from '../functions/findAndUploadBuildArtifacts';
import { generateGymfileFromTemplateFunction } from '../functions/generateGymfileFromTemplate';
import { injectAndroidCredentialsFunction } from '../functions/injectAndroidCredentials';
import { createInstallNodeModulesBuildFunction } from '../functions/installNodeModules';
import { createInstallPodsBuildFunction } from '../functions/installPods';
import { createPrebuildBuildFunction } from '../functions/prebuild';
import { resolveAppleTeamIdFromCredentialsFunction } from '../functions/resolveAppleTeamIdFromCredentials';
import { createResolveBuildConfigBuildFunction } from '../functions/resolveBuildConfig';
import {
  createCacheStatsBuildFunction,
  createRestoreBuildCacheFunction,
} from '../functions/restoreBuildCache';
import { runFastlaneFunction } from '../functions/runFastlane';
import { runGradleFunction } from '../functions/runGradle';
import { createSaveBuildCacheFunction } from '../functions/saveBuildCache';
import { createSetUpNpmrcBuildFunction } from '../functions/useNpmToken';

interface HelperFunctionsInput {
  globalCtx: BuildStepGlobalContext;
  buildToolsContext: CustomBuildContext<BuildJob>;
}

export function createEasBuildBuildFunctionGroup(
  buildToolsContext: CustomBuildContext<BuildJob>
): BuildFunctionGroup {
  return new BuildFunctionGroup({
    namespace: 'eas',
    id: 'build',
    createBuildStepsFromFunctionGroupCall: globalCtx => {
      if (buildToolsContext.job.platform === Platform.IOS) {
        if (buildToolsContext.job.simulator) {
          return createStepsForIosSimulatorBuild({
            globalCtx,
            buildToolsContext,
          });
        } else {
          return createStepsForIosBuildWithCredentials({
            globalCtx,
            buildToolsContext,
          });
        }
      } else if (buildToolsContext.job.platform === Platform.ANDROID) {
        if (!buildToolsContext.job.secrets?.buildCredentials) {
          return createStepsForAndroidBuildWithoutCredentials({
            globalCtx,
            buildToolsContext,
          });
        } else {
          return createStepsForAndroidBuildWithCredentials({
            globalCtx,
            buildToolsContext,
          });
        }
      }

      throw new Error('Build function group is not supported in generic jobs.');
    },
  });
}

function createStepsForIosSimulatorBuild({
  globalCtx,
  buildToolsContext,
}: HelperFunctionsInput): BuildStep[] {
  const calculateEASUpdateRuntimeVersion =
    calculateEASUpdateRuntimeVersionFunction().createBuildStepFromFunctionCall(globalCtx, {
      id: 'calculate_eas_update_runtime_version',
    });
  const installPods = createInstallPodsBuildFunction().createBuildStepFromFunctionCall(globalCtx, {
    workingDirectory: './ios',
  });
  const configureEASUpdate =
    configureEASUpdateIfInstalledFunction().createBuildStepFromFunctionCall(globalCtx, {
      callInputs: {
        throw_if_not_configured: false,
        resolved_eas_update_runtime_version:
          '${ steps.calculate_eas_update_runtime_version.resolved_eas_update_runtime_version }',
      },
    });
  const runFastlane = runFastlaneFunction().createBuildStepFromFunctionCall(globalCtx, {
    id: 'run_fastlane',
    callInputs: {
      resolved_eas_update_runtime_version:
        '${ steps.calculate_eas_update_runtime_version.resolved_eas_update_runtime_version }',
    },
  });
  return [
    createCheckoutBuildFunction().createBuildStepFromFunctionCall(globalCtx),
    createSetUpNpmrcBuildFunction().createBuildStepFromFunctionCall(globalCtx),
    createInstallNodeModulesBuildFunction().createBuildStepFromFunctionCall(globalCtx),
    createResolveBuildConfigBuildFunction(buildToolsContext).createBuildStepFromFunctionCall(
      globalCtx
    ),
    createPrebuildBuildFunction().createBuildStepFromFunctionCall(globalCtx),
    calculateEASUpdateRuntimeVersion,
    installPods,
    configureEASUpdate,
    ...(shouldUseEagerBundle(globalCtx.staticContext.metadata)
      ? [
          eagerBundleBuildFunction().createBuildStepFromFunctionCall(globalCtx, {
            callInputs: {
              resolved_eas_update_runtime_version:
                '${ steps.calculate_eas_update_runtime_version.resolved_eas_update_runtime_version }',
            },
          }),
        ]
      : []),
    generateGymfileFromTemplateFunction().createBuildStepFromFunctionCall(globalCtx),
    runFastlane,
    createFindAndUploadBuildArtifactsBuildFunction(
      buildToolsContext
    ).createBuildStepFromFunctionCall(globalCtx),
  ];
}

function createStepsForIosBuildWithCredentials({
  globalCtx,
  buildToolsContext,
}: HelperFunctionsInput): BuildStep[] {
  const evictUsedBefore = new Date();

  const resolveAppleTeamIdFromCredentials =
    resolveAppleTeamIdFromCredentialsFunction().createBuildStepFromFunctionCall(globalCtx, {
      id: 'resolve_apple_team_id_from_credentials',
    });
  const calculateEASUpdateRuntimeVersion =
    calculateEASUpdateRuntimeVersionFunction().createBuildStepFromFunctionCall(globalCtx, {
      id: 'calculate_eas_update_runtime_version',
    });
  const prebuildStep = createPrebuildBuildFunction().createBuildStepFromFunctionCall(globalCtx, {
    callInputs: {
      apple_team_id: '${ steps.resolve_apple_team_id_from_credentials.apple_team_id }',
    },
  });
  const restoreCache = createRestoreBuildCacheFunction().createBuildStepFromFunctionCall(
    globalCtx,
    {
      callInputs: {
        platform: Platform.IOS,
      },
    }
  );
  const installPods = createInstallPodsBuildFunction().createBuildStepFromFunctionCall(globalCtx, {
    workingDirectory: './ios',
  });
  const configureEASUpdate =
    configureEASUpdateIfInstalledFunction().createBuildStepFromFunctionCall(globalCtx, {
      callInputs: {
        throw_if_not_configured: false,
        resolved_eas_update_runtime_version:
          '${ steps.calculate_eas_update_runtime_version.resolved_eas_update_runtime_version }',
      },
    });
  const generateGymfile = generateGymfileFromTemplateFunction().createBuildStepFromFunctionCall(
    globalCtx,
    {
      callInputs: {
        credentials: '${ eas.job.secrets.buildCredentials }',
      },
    }
  );
  const runFastlane = runFastlaneFunction().createBuildStepFromFunctionCall(globalCtx, {
    id: 'run_fastlane',
    callInputs: {
      resolved_eas_update_runtime_version:
        '${ steps.calculate_eas_update_runtime_version.resolved_eas_update_runtime_version }',
    },
  });
  const saveCache = createSaveBuildCacheFunction(evictUsedBefore).createBuildStepFromFunctionCall(
    globalCtx,
    {
      callInputs: {
        platform: Platform.IOS,
      },
    }
  );
  return [
    createCheckoutBuildFunction().createBuildStepFromFunctionCall(globalCtx),
    createSetUpNpmrcBuildFunction().createBuildStepFromFunctionCall(globalCtx),
    createInstallNodeModulesBuildFunction().createBuildStepFromFunctionCall(globalCtx),
    createResolveBuildConfigBuildFunction(buildToolsContext).createBuildStepFromFunctionCall(
      globalCtx
    ),
    resolveAppleTeamIdFromCredentials,
    prebuildStep,
    restoreCache,
    calculateEASUpdateRuntimeVersion,
    installPods,
    configureEASUpdate,
    configureIosCredentialsFunction().createBuildStepFromFunctionCall(globalCtx),
    configureIosVersionFunction().createBuildStepFromFunctionCall(globalCtx),
    ...(shouldUseEagerBundle(globalCtx.staticContext.metadata)
      ? [
          eagerBundleBuildFunction().createBuildStepFromFunctionCall(globalCtx, {
            callInputs: {
              resolved_eas_update_runtime_version:
                '${ steps.calculate_eas_update_runtime_version.resolved_eas_update_runtime_version }',
            },
          }),
        ]
      : []),
    generateGymfile,
    runFastlane,
    createFindAndUploadBuildArtifactsBuildFunction(
      buildToolsContext
    ).createBuildStepFromFunctionCall(globalCtx),
    saveCache,
    createCacheStatsBuildFunction().createBuildStepFromFunctionCall(globalCtx),
  ];
}

function createStepsForAndroidBuildWithoutCredentials({
  globalCtx,
  buildToolsContext,
}: HelperFunctionsInput): BuildStep[] {
  const evictUsedBefore = new Date();

  const calculateEASUpdateRuntimeVersion =
    calculateEASUpdateRuntimeVersionFunction().createBuildStepFromFunctionCall(globalCtx, {
      id: 'calculate_eas_update_runtime_version',
    });
  const configureEASUpdate =
    configureEASUpdateIfInstalledFunction().createBuildStepFromFunctionCall(globalCtx, {
      callInputs: {
        throw_if_not_configured: false,
        resolved_eas_update_runtime_version:
          '${ steps.calculate_eas_update_runtime_version.resolved_eas_update_runtime_version }',
      },
    });
  const restoreCache = createRestoreBuildCacheFunction().createBuildStepFromFunctionCall(
    globalCtx,
    {
      callInputs: {
        platform: Platform.ANDROID,
      },
    }
  );
  const runGradle = runGradleFunction().createBuildStepFromFunctionCall(globalCtx, {
    id: 'run_gradle',
    callInputs: {
      resolved_eas_update_runtime_version:
        '${ steps.calculate_eas_update_runtime_version.resolved_eas_update_runtime_version }',
    },
  });
  const saveCache = createSaveBuildCacheFunction(evictUsedBefore).createBuildStepFromFunctionCall(
    globalCtx,
    {
      callInputs: {
        platform: Platform.ANDROID,
      },
    }
  );
  return [
    createCheckoutBuildFunction().createBuildStepFromFunctionCall(globalCtx),
    createSetUpNpmrcBuildFunction().createBuildStepFromFunctionCall(globalCtx),
    createInstallNodeModulesBuildFunction().createBuildStepFromFunctionCall(globalCtx),
    createResolveBuildConfigBuildFunction(buildToolsContext).createBuildStepFromFunctionCall(
      globalCtx
    ),
    createPrebuildBuildFunction().createBuildStepFromFunctionCall(globalCtx),
    restoreCache,
    calculateEASUpdateRuntimeVersion,
    configureEASUpdate,
    ...(shouldUseEagerBundle(globalCtx.staticContext.metadata)
      ? [
          eagerBundleBuildFunction().createBuildStepFromFunctionCall(globalCtx, {
            callInputs: {
              resolved_eas_update_runtime_version:
                '${ steps.calculate_eas_update_runtime_version.resolved_eas_update_runtime_version }',
            },
          }),
        ]
      : []),
    runGradle,
    createFindAndUploadBuildArtifactsBuildFunction(
      buildToolsContext
    ).createBuildStepFromFunctionCall(globalCtx),
    saveCache,
    createCacheStatsBuildFunction().createBuildStepFromFunctionCall(globalCtx),
  ];
}

function createStepsForAndroidBuildWithCredentials({
  globalCtx,
  buildToolsContext,
}: HelperFunctionsInput): BuildStep[] {
  const evictUsedBefore = new Date();

  const calculateEASUpdateRuntimeVersion =
    calculateEASUpdateRuntimeVersionFunction().createBuildStepFromFunctionCall(globalCtx, {
      id: 'calculate_eas_update_runtime_version',
    });
  const configureEASUpdate =
    configureEASUpdateIfInstalledFunction().createBuildStepFromFunctionCall(globalCtx, {
      callInputs: {
        throw_if_not_configured: false,
        resolved_eas_update_runtime_version:
          '${ steps.calculate_eas_update_runtime_version.resolved_eas_update_runtime_version }',
      },
    });
  const restoreCache = createRestoreBuildCacheFunction().createBuildStepFromFunctionCall(
    globalCtx,
    {
      callInputs: {
        platform: Platform.ANDROID,
      },
    }
  );
  const runGradle = runGradleFunction().createBuildStepFromFunctionCall(globalCtx, {
    id: 'run_gradle',
    callInputs: {
      resolved_eas_update_runtime_version:
        '${ steps.calculate_eas_update_runtime_version.resolved_eas_update_runtime_version }',
    },
  });
  const saveCache = createSaveBuildCacheFunction(evictUsedBefore).createBuildStepFromFunctionCall(
    globalCtx,
    {
      callInputs: {
        platform: Platform.ANDROID,
      },
    }
  );
  return [
    createCheckoutBuildFunction().createBuildStepFromFunctionCall(globalCtx),
    createSetUpNpmrcBuildFunction().createBuildStepFromFunctionCall(globalCtx),
    createInstallNodeModulesBuildFunction().createBuildStepFromFunctionCall(globalCtx),
    createResolveBuildConfigBuildFunction(buildToolsContext).createBuildStepFromFunctionCall(
      globalCtx
    ),
    createPrebuildBuildFunction().createBuildStepFromFunctionCall(globalCtx),
    restoreCache,
    calculateEASUpdateRuntimeVersion,
    configureEASUpdate,
    injectAndroidCredentialsFunction().createBuildStepFromFunctionCall(globalCtx),
    configureAndroidVersionFunction().createBuildStepFromFunctionCall(globalCtx),
    runGradle,
    ...(shouldUseEagerBundle(globalCtx.staticContext.metadata)
      ? [
          eagerBundleBuildFunction().createBuildStepFromFunctionCall(globalCtx, {
            callInputs: {
              resolved_eas_update_runtime_version:
                '${ steps.calculate_eas_update_runtime_version.resolved_eas_update_runtime_version }',
            },
          }),
        ]
      : []),
    createFindAndUploadBuildArtifactsBuildFunction(
      buildToolsContext
    ).createBuildStepFromFunctionCall(globalCtx),
    saveCache,
    createCacheStatsBuildFunction().createBuildStepFromFunctionCall(globalCtx),
  ];
}
