import { AndroidConfig } from '@expo/config-plugins';
import { Platform, Workflow } from '@expo/eas-build-job';
import { BuildProfile } from '@expo/eas-json';

import Log from '../../log';
import { resolveWorkflowAsync } from '../../project/workflow';

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
        const buildGradle = await AndroidConfig.BuildGradle.getAppBuildGradleAsync(projectDir);
        const parsedGradleCommand = buildProfile.gradleCommand
          ? AndroidConfig.BuildGradle.parseGradleCommand(buildProfile.gradleCommand, buildGradle)
          : undefined;
        if (parsedGradleCommand?.moduleName && parsedGradleCommand.moduleName !== 'app') {
          Log.warn('Building modules different than "app" migth result in unexpected behavior');
        }
        return {
          moduleName: parsedGradleCommand?.moduleName ?? 'app',
          flavor: parsedGradleCommand?.flavor,
        };
      } else {
        return { moduleName: 'app' };
      }
    } catch (err: any) {
      Log.warn(`Unable to read project config from app/build.gradle: ${err.message}`);
      return undefined;
    }
  } else {
    return { moduleName: 'app' };
  }
}
