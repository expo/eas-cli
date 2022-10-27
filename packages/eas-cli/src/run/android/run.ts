import { getAptParametersAsync } from './aapt';
import * as emulator from './emulator';

export async function runAppOnAndroidEmulatorAsync(appPath: string): Promise<void> {
  const selectedEmulator = await emulator.selectEmulatorAsync();

  const bootedEmulator = await emulator.ensureEmulatorBootedAsync(selectedEmulator);

  await emulator.installAppAsync(bootedEmulator, appPath);

  const { packageName, activityName } = await getAptParametersAsync(appPath);

  await emulator.startAppAsync(bootedEmulator, packageName, activityName);
}
