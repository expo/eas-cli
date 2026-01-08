import path from 'path';

import { Ios } from '@expo/eas-build-job';
import fs from 'fs-extra';

import { BuildContext } from '../context';

export async function deleteXcodeEnvLocalIfExistsAsync(ctx: BuildContext<Ios.Job>): Promise<void> {
  const xcodeEnvLocalPath = path.join(
    ctx.getReactNativeProjectDirectory(),
    'ios',
    '.xcode.env.local'
  );
  if (await fs.pathExists(xcodeEnvLocalPath)) {
    ctx.markBuildPhaseHasWarnings();
    ctx.logger.warn(
      `Detected and removed file: ios/.xcode.env.local. This file should not be committed to source control. Learn more: https://expo.fyi/xcode-env-local`
    );
    await fs.remove(xcodeEnvLocalPath);
  }
}
