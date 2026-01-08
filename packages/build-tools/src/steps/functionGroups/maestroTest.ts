import {
  BuildFunctionGroup,
  BuildStep,
  BuildStepInput,
  BuildStepInputValueTypeName,
} from '@expo/steps';
import { Platform } from '@expo/eas-build-job';

import { CustomBuildContext } from '../../customBuildContext';
import { createInstallMaestroBuildFunction } from '../functions/installMaestro';
import { createStartIosSimulatorBuildFunction } from '../functions/startIosSimulator';
import { createStartAndroidEmulatorBuildFunction } from '../functions/startAndroidEmulator';
import { createUploadArtifactBuildFunction } from '../functions/uploadArtifact';

export function createEasMaestroTestFunctionGroup(
  buildToolsContext: CustomBuildContext
): BuildFunctionGroup {
  return new BuildFunctionGroup({
    namespace: 'eas',
    id: 'maestro_test',
    inputProviders: [
      BuildStepInput.createProvider({
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
        id: 'flow_path',
        required: true,
      }),
      BuildStepInput.createProvider({
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
        id: 'app_path',
        required: false,
      }),
      BuildStepInput.createProvider({
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
        id: 'android_emulator_system_image_package',
        required: false,
      }),
    ],
    createBuildStepsFromFunctionGroupCall: (globalCtx, { inputs }) => {
      const steps: BuildStep[] = [
        createInstallMaestroBuildFunction().createBuildStepFromFunctionCall(globalCtx),
      ];

      if (buildToolsContext.job.platform === Platform.IOS) {
        steps.push(
          createStartIosSimulatorBuildFunction().createBuildStepFromFunctionCall(globalCtx)
        );
        const searchPath =
          inputs.app_path.getValue({
            interpolationContext: globalCtx.getInterpolationContext(),
          }) ?? 'ios/build/Build/Products/*simulator/*.app';
        steps.push(
          new BuildStep(globalCtx, {
            id: BuildStep.getNewId(),
            name: 'install_app',
            displayName: `Install app to Simulator`,
            command: `
              # shopt -s nullglob is necessary not to try to install
              # SEARCH_PATH literally if there are no matching files.
              shopt -s nullglob

              SEARCH_PATH="${searchPath}"
              FILES_FOUND=false

              for APP_PATH in $SEARCH_PATH; do
                FILES_FOUND=true
                echo "Installing \\"$APP_PATH\\""
                xcrun simctl install booted "$APP_PATH"
              done

              if ! $FILES_FOUND; then
                echo "No files found matching \\"$SEARCH_PATH\\". Are you sure you've built a Simulator app?"
                exit 1
              fi
            `,
          })
        );
      } else if (buildToolsContext.job.platform === Platform.ANDROID) {
        const system_image_package = inputs.android_emulator_system_image_package.getValue({
          interpolationContext: globalCtx.getInterpolationContext(),
        });
        steps.push(
          createStartAndroidEmulatorBuildFunction().createBuildStepFromFunctionCall(
            globalCtx,
            system_image_package
              ? {
                  callInputs: {
                    system_image_package,
                  },
                }
              : undefined
          )
        );
        const searchPath =
          inputs.app_path.getValue({
            interpolationContext: globalCtx.getInterpolationContext(),
          }) ?? 'android/app/build/outputs/**/*.apk';
        steps.push(
          new BuildStep(globalCtx, {
            id: BuildStep.getNewId(),
            name: 'install_app',
            displayName: `Install app to Emulator`,
            command: `
              # shopt -s globstar is necessary to add /**/ support
              shopt -s globstar
              # shopt -s nullglob is necessary not to try to install
              # SEARCH_PATH literally if there are no matching files.
              shopt -s nullglob

              SEARCH_PATH="${searchPath}"
              FILES_FOUND=false

              for APP_PATH in $SEARCH_PATH; do
                FILES_FOUND=true
                echo "Installing \\"$APP_PATH\\""
                adb install "$APP_PATH"
              done

              if ! $FILES_FOUND; then
                echo "No files found matching \\"$SEARCH_PATH\\". Are you sure you've built an Emulator app?"
                exit 1
              fi
            `,
          })
        );
      }

      const flowPaths = `${inputs.flow_path.getValue({
        interpolationContext: globalCtx.getInterpolationContext(),
      })}`
        .split('\n') // It's easy to get an empty line with YAML
        .filter((entry) => entry);

      for (const flowPath of flowPaths) {
        steps.push(
          new BuildStep(globalCtx, {
            id: BuildStep.getNewId(),
            name: 'maestro_test',
            ifCondition: '${ always() }',
            displayName: `maestro test ${flowPath}`,
            command: `maestro test ${flowPath}`,
          })
        );
      }

      steps.push(
        createUploadArtifactBuildFunction(buildToolsContext).createBuildStepFromFunctionCall(
          globalCtx,
          {
            ifCondition: '${ always() }',
            name: 'Upload Maestro test results',
            callInputs: {
              path: '${ eas.env.HOME }/.maestro/tests',
              ignore_error: true,
              type: 'build-artifact',
            },
          }
        )
      );

      return steps;
    },
  });
}
