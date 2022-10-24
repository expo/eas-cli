import { AppPlatform } from '../graphql/generated';
import { runAppOnAndroidEmulatorAsync } from './android/run';
import { runAppOnIosSimulatorAsync } from './ios/run';

export interface RunArchiveFlags {
  latest?: boolean;
  id?: string;
  path?: string;
  url?: string;
}

export async function runAsync(
  simulatorBuildPath: string,
  selectedPlatform: AppPlatform
): Promise<void> {
  if (selectedPlatform === AppPlatform.Ios) {
    await runAppOnIosSimulatorAsync(simulatorBuildPath);
  } else {
    await runAppOnAndroidEmulatorAsync(simulatorBuildPath);
  }
}
