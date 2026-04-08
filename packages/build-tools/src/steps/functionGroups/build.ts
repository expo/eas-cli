import { BuildJob, Platform } from '@expo/eas-build-job';
import {
  BuildFunctionGroup,
  BuildStep,
  BuildStepGlobalContext,
  BuildStepInput,
  BuildStepInputValueTypeName,
} from '@expo/steps';
import path from 'path';

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
  workingDirectory?: string;
}

export function createEasBuildBuildFunctionGroup(
  buildToolsContext: CustomBuildContext<BuildJob>
): BuildFunctionGroup {
  return new BuildFunctionGroup({
    namespace: 'eas',
    id: 'build',
    inputProviders: [
      BuildStepInput.createProvider({
        id: 'working_directory',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
    ],
    createBuildStepsFromFunctionGroupCall: (globalCtx, { inputs }) => {
      const workingDirectory = inputs.working_directory?.getValue({
        interpolationContext: globalCtx.getInterpolationContext(),
      }) as string | undefined;

      if (buildToolsContext.job.platform === Platform.IOS) {
        if (buildToolsContext.job.simulator) {
          return createStepsForIosSimulatorBuild({
            globalCtx,
            buildToolsContext,
            workingDirectory,
          });
        } else {
          return createStepsForIosBuildWithCredentials({
            globalCtx,
            buildToolsContext,
            workingDirectory,
          });
        }
      } else if (buildToolsContext.job.platform === Platform.ANDROID) {
        if (!buildToolsContext.job.secrets?.buildCredentials) {
          return createStepsForAndroidBuildWithoutCredentials({
            globalCtx,
            buildToolsContext,
            workingDirectory,
          });
        } else {
          return createStepsForAndroidBuildWithCredentials({
            globalCtx,
            buildToolsContext,
            workingDirectory,
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
  workingDirectory,
}: HelperFunctionsInput): BuildStep[] {
  const calculateEASUpdateRuntimeVersion =
    calculateEASUpdateRuntimeVersionFunction().createBuildStepFromFunctionCall(globalCtx, {
      id: 'calculate_eas_update_runtime_version',
      workingDirectory,
    });
  const installPods = createInstallPodsBuildFunction().createBuildStepFromFunctionCall(globalCtx, {
    workingDirectory: workingDirectory ? path.join(workingDirectory, './ios') : './ios',
  });
  const configureEASUpdate =
    configureEASUpdateIfInstalledFunction().createBuildStepFromFunctionCall(globalCtx, {
      workingDirectory,
      callInputs: {
        throw_if_not_configured: false,
        resolved_eas_update_runtime_version:
          '${ steps.calculate_eas_update_runtime_version.resolved_eas_update_runtime_version }',
      },
    });
  const runFastlane = runFastlaneFunction().createBuildStepFromFunctionCall(globalCtx, {
    id: 'run_fastlane',
    workingDirectory,
    callInputs: {
      resolved_eas_update_runtime_version:
        '${ steps.calculate_eas_update_runtime_version.resolved_eas_update_runtime_version }',
    },
  });
  return [
    createCheckoutBuildFunction().createBuildStepFromFunctionCall(globalCtx),
    createSetUpNpmrcBuildFunction().createBuildStepFromFunctionCall(globalCtx, {
      workingDirectory,
    }),
    createInstallNodeModulesBuildFunction().createBuildStepFromFunctionCall(globalCtx, {
      workingDirectory,
    }),
    createResolveBuildConfigBuildFunction(buildToolsContext).createBuildStepFromFunctionCall(
      globalCtx,
      { workingDirectory }
    ),
    createPrebuildBuildFunction().createBuildStepFromFunctionCall(globalCtx, {
      workingDirectory,
    }),
    calculateEASUpdateRuntimeVersion,
    installPods,
    configureEASUpdate,
    ...(shouldUseEagerBundle(globalCtx.staticContext.metadata)
      ? [
          eagerBundleBuildFunction().createBuildStepFromFunctionCall(globalCtx, {
            workingDirectory,
            callInputs: {
              resolved_eas_update_runtime_version:
                '${ steps.calculate_eas_update_runtime_version.resolved_eas_update_runtime_version }',
            },
          }),
        ]
      : []),
    generateGymfileFromTemplateFunction().createBuildStepFromFunctionCall(globalCtx, {
      workingDirectory,
    }),
    runFastlane,
    createFindAndUploadBuildArtifactsBuildFunction(
      buildToolsContext
    ).createBuildStepFromFunctionCall(globalCtx, { workingDirectory }),
  ];
}

function createStepsForIosBuildWithCredentials({
  globalCtx,
  buildToolsContext,
  workingDirectory,
}: HelperFunctionsInput): BuildStep[] {
  const evictUsedBefore = new Date();

  const resolveAppleTeamIdFromCredentials =
    resolveAppleTeamIdFromCredentialsFunction().createBuildStepFromFunctionCall(globalCtx, {
      id: 'resolve_apple_team_id_from_credentials',
      workingDirectory,
    });
  const calculateEASUpdateRuntimeVersion =
    calculateEASUpdateRuntimeVersionFunction().createBuildStepFromFunctionCall(globalCtx, {
      id: 'calculate_eas_update_runtime_version',
      workingDirectory,
    });
  const prebuildStep = createPrebuildBuildFunction().createBuildStepFromFunctionCall(globalCtx, {
    workingDirectory,
    callInputs: {
      apple_team_id: '${ steps.resolve_apple_team_id_from_credentials.apple_team_id }',
    },
  });
  const restoreCache = createRestoreBuildCacheFunction().createBuildStepFromFunctionCall(
    globalCtx,
    {
      workingDirectory,
      callInputs: {
        platform: Platform.IOS,
      },
    }
  );
  const installPods = createInstallPodsBuildFunction().createBuildStepFromFunctionCall(globalCtx, {
    workingDirectory: workingDirectory ? path.join(workingDirectory, './ios') : './ios',
  });
  const configureEASUpdate =
    configureEASUpdateIfInstalledFunction().createBuildStepFromFunctionCall(globalCtx, {
      workingDirectory,
      callInputs: {
        throw_if_not_configured: false,
        resolved_eas_update_runtime_version:
          '${ steps.calculate_eas_update_runtime_version.resolved_eas_update_runtime_version }',
      },
    });
  const generateGymfile = generateGymfileFromTemplateFunction().createBuildStepFromFunctionCall(
    globalCtx,
    {
      workingDirectory,
      callInputs: {
        credentials: '${ eas.job.secrets.buildCredentials }',
      },
    }
  );
  const runFastlane = runFastlaneFunction().createBuildStepFromFunctionCall(globalCtx, {
    id: 'run_fastlane',
    workingDirectory,
    callInputs: {
      resolved_eas_update_runtime_version:
        '${ steps.calculate_eas_update_runtime_version.resolved_eas_update_runtime_version }',
    },
  });
  const saveCache = createSaveBuildCacheFunction(evictUsedBefore).createBuildStepFromFunctionCall(
    globalCtx,
    {
      workingDirectory,
      callInputs: {
        platform: Platform.IOS,
      },
    }
  );
  return [
    createCheckoutBuildFunction().createBuildStepFromFunctionCall(globalCtx),
    createSetUpNpmrcBuildFunction().createBuildStepFromFunctionCall(globalCtx, {
      workingDirectory,
    }),
    createInstallNodeModulesBuildFunction().createBuildStepFromFunctionCall(globalCtx, {
      workingDirectory,
    }),
    createResolveBuildConfigBuildFunction(buildToolsContext).createBuildStepFromFunctionCall(
      globalCtx,
      { workingDirectory }
    ),
    resolveAppleTeamIdFromCredentials,
    prebuildStep,
    restoreCache,
    calculateEASUpdateRuntimeVersion,
    installPods,
    configureEASUpdate,
    configureIosCredentialsFunction().createBuildStepFromFunctionCall(globalCtx, {
      workingDirectory,
    }),
    configureIosVersionFunction().createBuildStepFromFunctionCall(globalCtx, {
      workingDirectory,
    }),
    ...(shouldUseEagerBundle(globalCtx.staticContext.metadata)
      ? [
          eagerBundleBuildFunction().createBuildStepFromFunctionCall(globalCtx, {
            workingDirectory,
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
    ).createBuildStepFromFunctionCall(globalCtx, { workingDirectory }),
    saveCache,
    createCacheStatsBuildFunction().createBuildStepFromFunctionCall(globalCtx, {
      workingDirectory,
    }),
  ];
}

function createStepsForAndroidBuildWithoutCredentials({
  globalCtx,
  buildToolsContext,
  workingDirectory,
}: HelperFunctionsInput): BuildStep[] {
  const evictUsedBefore = new Date();

  const calculateEASUpdateRuntimeVersion =
    calculateEASUpdateRuntimeVersionFunction().createBuildStepFromFunctionCall(globalCtx, {
      id: 'calculate_eas_update_runtime_version',
      workingDirectory,
    });
  const configureEASUpdate =
    configureEASUpdateIfInstalledFunction().createBuildStepFromFunctionCall(globalCtx, {
      workingDirectory,
      callInputs: {
        throw_if_not_configured: false,
        resolved_eas_update_runtime_version:
          '${ steps.calculate_eas_update_runtime_version.resolved_eas_update_runtime_version }',
      },
    });
  const restoreCache = createRestoreBuildCacheFunction().createBuildStepFromFunctionCall(
    globalCtx,
    {
      workingDirectory,
      callInputs: {
        platform: Platform.ANDROID,
      },
    }
  );
  const runGradle = runGradleFunction().createBuildStepFromFunctionCall(globalCtx, {
    id: 'run_gradle',
    workingDirectory,
    callInputs: {
      resolved_eas_update_runtime_version:
        '${ steps.calculate_eas_update_runtime_version.resolved_eas_update_runtime_version }',
    },
  });
  const saveCache = createSaveBuildCacheFunction(evictUsedBefore).createBuildStepFromFunctionCall(
    globalCtx,
    {
      workingDirectory,
      callInputs: {
        platform: Platform.ANDROID,
      },
    }
  );
  return [
    createCheckoutBuildFunction().createBuildStepFromFunctionCall(globalCtx),
    createSetUpNpmrcBuildFunction().createBuildStepFromFunctionCall(globalCtx, {
      workingDirectory,
    }),
    createInstallNodeModulesBuildFunction().createBuildStepFromFunctionCall(globalCtx, {
      workingDirectory,
    }),
    createResolveBuildConfigBuildFunction(buildToolsContext).createBuildStepFromFunctionCall(
      globalCtx,
      { workingDirectory }
    ),
    createPrebuildBuildFunction().createBuildStepFromFunctionCall(globalCtx, {
      workingDirectory,
    }),
    restoreCache,
    calculateEASUpdateRuntimeVersion,
    configureEASUpdate,
    ...(shouldUseEagerBundle(globalCtx.staticContext.metadata)
      ? [
          eagerBundleBuildFunction().createBuildStepFromFunctionCall(globalCtx, {
            workingDirectory,
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
    ).createBuildStepFromFunctionCall(globalCtx, { workingDirectory }),
    saveCache,
    createCacheStatsBuildFunction().createBuildStepFromFunctionCall(globalCtx, {
      workingDirectory,
    }),
  ];
}

function createStepsForAndroidBuildWithCredentials({
  globalCtx,
  buildToolsContext,
  workingDirectory,
}: HelperFunctionsInput): BuildStep[] {
  const evictUsedBefore = new Date();

  const calculateEASUpdateRuntimeVersion =
    calculateEASUpdateRuntimeVersionFunction().createBuildStepFromFunctionCall(globalCtx, {
      id: 'calculate_eas_update_runtime_version',
      workingDirectory,
    });
  const configureEASUpdate =
    configureEASUpdateIfInstalledFunction().createBuildStepFromFunctionCall(globalCtx, {
      workingDirectory,
      callInputs: {
        throw_if_not_configured: false,
        resolved_eas_update_runtime_version:
          '${ steps.calculate_eas_update_runtime_version.resolved_eas_update_runtime_version }',
      },
    });
  const restoreCache = createRestoreBuildCacheFunction().createBuildStepFromFunctionCall(
    globalCtx,
    {
      workingDirectory,
      callInputs: {
        platform: Platform.ANDROID,
      },
    }
  );
  const runGradle = runGradleFunction().createBuildStepFromFunctionCall(globalCtx, {
    id: 'run_gradle',
    workingDirectory,
    callInputs: {
      resolved_eas_update_runtime_version:
        '${ steps.calculate_eas_update_runtime_version.resolved_eas_update_runtime_version }',
    },
  });
  const saveCache = createSaveBuildCacheFunction(evictUsedBefore).createBuildStepFromFunctionCall(
    globalCtx,
    {
      workingDirectory,
      callInputs: {
        platform: Platform.ANDROID,
      },
    }
  );
  return [
    createCheckoutBuildFunction().createBuildStepFromFunctionCall(globalCtx),
    createSetUpNpmrcBuildFunction().createBuildStepFromFunctionCall(globalCtx, {
      workingDirectory,
    }),
    createInstallNodeModulesBuildFunction().createBuildStepFromFunctionCall(globalCtx, {
      workingDirectory,
    }),
    createResolveBuildConfigBuildFunction(buildToolsContext).createBuildStepFromFunctionCall(
      globalCtx,
      { workingDirectory }
    ),
    createPrebuildBuildFunction().createBuildStepFromFunctionCall(globalCtx, {
      workingDirectory,
    }),
    restoreCache,
    calculateEASUpdateRuntimeVersion,
    configureEASUpdate,
    injectAndroidCredentialsFunction().createBuildStepFromFunctionCall(globalCtx, {
      workingDirectory,
    }),
    configureAndroidVersionFunction().createBuildStepFromFunctionCall(globalCtx, {
      workingDirectory,
    }),
    runGradle,
    ...(shouldUseEagerBundle(globalCtx.staticContext.metadata)
      ? [
          eagerBundleBuildFunction().createBuildStepFromFunctionCall(globalCtx, {
            workingDirectory,
            callInputs: {
              resolved_eas_update_runtime_version:
                '${ steps.calculate_eas_update_runtime_version.resolved_eas_update_runtime_version }',
            },
          }),
        ]
      : []),
    createFindAndUploadBuildArtifactsBuildFunction(
      buildToolsContext
    ).createBuildStepFromFunctionCall(globalCtx, { workingDirectory }),
    saveCache,
    createCacheStatsBuildFunction().createBuildStepFromFunctionCall(globalCtx, {
      workingDirectory,
    }),
  ];
}
