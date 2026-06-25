import { Android } from '@expo/eas-build-job';

export { runGradleCommand } from '../../../utils/gradle';

export function resolveGradleCommand(job: Android.Job, command?: string): string {
  if (command) {
    return command;
  } else if (job.gradleCommand) {
    return job.gradleCommand;
  } else if (job.developmentClient) {
    return ':app:assembleDebug';
  } else if (!job.buildType) {
    return ':app:bundleRelease';
  } else if (job.buildType === Android.BuildType.APK) {
    return ':app:assembleRelease';
  } else {
    return ':app:bundleRelease';
  }
}
