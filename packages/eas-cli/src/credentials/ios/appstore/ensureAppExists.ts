import ora from 'ora';

import { AuthCtx } from './authenticate';
import { runActionAsync, travelingFastlane } from './fastlane';

export interface AppLookupParams {
  accountName: string;
  projectName: string;
  bundleIdentifier: string;
}

export interface EnsureAppExistsOptions {
  enablePushNotifications?: boolean;
}

export async function ensureAppExistsAsync(
  authCtx: AuthCtx,
  app: AppLookupParams,
  options: EnsureAppExistsOptions = {}
): Promise<void> {
  const { appleId, appleIdPassword, team } = authCtx;
  const spinner = ora(`Ensuring App ID exists on Apple Developer Portal...`).start();
  try {
    const { created } = await runActionAsync(travelingFastlane.ensureAppExists, [
      ...(options.enablePushNotifications ? ['--push-notifications'] : []),
      appleId,
      appleIdPassword,
      team.id,
      app.bundleIdentifier,
      `@${app.accountName}/${app.projectName}`,
    ]);
    if (created) {
      spinner.succeed(`App ID created with bundle identifier ${app.bundleIdentifier}.`);
    } else {
      spinner.succeed('App ID found on Apple Developer Portal.');
    }
  } catch (err) {
    spinner.fail(
      'Something went wrong when trying to ensure App ID exists on Apple Developer Portal!'
    );
    throw err;
  }
}
