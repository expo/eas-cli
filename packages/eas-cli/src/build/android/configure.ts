import { AndroidConfig } from '@expo/config';

import log from '../../log';
import { gitAddAsync } from '../../utils/git';
import { ConfigureContext } from '../context';
import { isExpoUpdatesInstalled } from '../utils/updates';
import { configureUpdatesAsync } from './UpdatesModule';

export async function configureAndroidAsync(ctx: ConfigureContext): Promise<void> {
  if (!ctx.hasAndroidNativeProject) {
    return;
  }
  await AndroidConfig.EasBuild.configureEasBuildAsync(ctx.projectDir);

  const easGradlePath = AndroidConfig.EasBuild.getEasBuildGradlePath(ctx.projectDir);
  await gitAddAsync(easGradlePath, { intentToAdd: true });

  if (isExpoUpdatesInstalled(ctx.projectDir)) {
    await configureUpdatesAsync(ctx.projectDir, ctx.exp);
  }
  log.withTick('Configured the Android project');
}
