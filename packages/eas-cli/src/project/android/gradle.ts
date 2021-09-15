import { Platform, Workflow } from '@expo/eas-build-job';
import { BuildProfile } from '@expo/eas-json';

import Log from '../../log';
import { resolveWorkflowAsync } from '../../project/workflow';
import * as gradleUtils from './gradleUtils';

export interface GradleBuildContext {
  moduleName?: string;
  flavor?: string;
}

export async function resolveGradleBuildContextAsync(
  projectDir: string,
  buildProfile: BuildProfile<Platform.ANDROID>
): Promise<GradleBuildContext | undefined> {
  const workflow = await resolveWorkflowAsync(projectDir, Platform.ANDROID);
  if (workflow === Workflow.GENERIC) {
    try {
      if (buildProfile.gradleCommand) {
        const buildGradle = await gradleUtils.getAppBuildGradleAsync(projectDir);
        const parsedGradleCommand = buildProfile.gradleCommand
          ? gradleUtils.parseGradleCommand(buildProfile.gradleCommand, buildGradle)
          : undefined;
        if (
          parsedGradleCommand?.moduleName &&
          parsedGradleCommand.moduleName !== gradleUtils.DEFAULT_MODULE_NAME
        ) {
          Log.warn(
            `Building modules different than "${gradleUtils.DEFAULT_MODULE_NAME}" might result in unexpected behavior`
          );
        }
        return {
          moduleName: parsedGradleCommand?.moduleName ?? gradleUtils.DEFAULT_MODULE_NAME,
          flavor: parsedGradleCommand?.flavor,
        };
      } else {
        return { moduleName: gradleUtils.DEFAULT_MODULE_NAME };
      }
    } catch (err: any) {
      Log.warn(`Unable to read project config from app/build.gradle: ${err.message}`);
      return undefined;
    }
  } else {
    return { moduleName: gradleUtils.DEFAULT_MODULE_NAME };
  }
}
