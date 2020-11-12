import { BundleId, CapabilityType, CapabilityTypeOption, Session, Teams } from '@expo/apple-utils';
import ora from 'ora';

import { AuthCtx, authenticateAsync } from './authenticate';
import { USE_APPLE_UTILS } from './experimental';
import { runActionAsync, travelingFastlane } from './fastlane';

type Options = {
  enablePushNotifications?: boolean;
};

interface BundleIdActionProps {
  accountName: string;
  projectName: string;
  bundleIdentifier: string;
}

export async function ensureAuthenticatedAsync(
  appleCtx: Omit<AuthCtx, 'fastlaneSession'>
): Promise<Omit<AuthCtx, 'fastlaneSession'>> {
  if (!Session.getSessionInfo()) {
    appleCtx = await authenticateAsync({
      appleId: appleCtx.appleId,
      teamId: appleCtx.team.id,
    });
  }
  Teams.setSelectedTeamId(appleCtx.team.id);
  return appleCtx;
}

async function ensureBundleIdExistsAsync(
  appleCtx: Omit<AuthCtx, 'fastlaneSession'>,
  { accountName, projectName, bundleIdentifier }: BundleIdActionProps,
  options: Options = {}
) {
  let spinner = ora(`Registering Bundle ID "${bundleIdentifier}"`).start();

  appleCtx = await ensureAuthenticatedAsync(appleCtx);

  // Get the bundle id
  let bundleId = await BundleId.findAsync({ identifier: bundleIdentifier });

  if (bundleId) {
    spinner.succeed('Bundle ID already registered');
  } else {
    // If it doesn't exist, create it
    bundleId = await BundleId.createAsync({
      name: `@${accountName}/${projectName}`,
      identifier: bundleIdentifier,
    });
    spinner.succeed(`Registered Bundle ID "${bundleIdentifier}"`);
  }

  spinner = ora(`Syncing app capabilities`).start();

  // Update the capabilities
  await bundleId.updateBundleIdCapabilityAsync({
    capabilityType: CapabilityType.PUSH_NOTIFICATIONS,
    option: options.enablePushNotifications ? CapabilityTypeOption.ON : CapabilityTypeOption.OFF,
    // TODO: Add more capabilities
  });
  spinner.succeed(`Sync'd app capabilities`);
}

export async function ensureAppExists(
  appleCtx: Omit<AuthCtx, 'fastlaneSession'>,
  { accountName, projectName, bundleIdentifier }: BundleIdActionProps,
  options: Options = {}
) {
  if (USE_APPLE_UTILS) {
    return await ensureBundleIdExistsAsync(
      appleCtx,
      { accountName, projectName, bundleIdentifier },
      options
    );
  }

  const { appleId, appleIdPassword, team } = appleCtx;

  const spinner = ora(`Ensuring App ID exists on Apple Developer Portal...`).start();
  try {
    const { created } = await runActionAsync(travelingFastlane.ensureAppExists, [
      ...(options.enablePushNotifications ? ['--push-notifications'] : []),
      appleId,
      appleIdPassword,
      team.id,
      bundleIdentifier,
      `@${accountName}/${projectName}`,
    ]);
    if (created) {
      spinner.succeed(`App ID created with bundle identifier ${bundleIdentifier}.`);
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
