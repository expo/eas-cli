import { App, BetaGroup, Session, User, UserRole } from '@expo/apple-utils';

import { isAppleError } from './ensureAppExists';
import Log from '../../../log';
import { ora } from '../../../ora';
import { confirmAsync } from '../../../prompts';

// The name of the internal TestFlight group, this should probably never change.
const AUTO_GROUP_NAME = 'Team (Expo)';

/**
 * Ensure a TestFlight internal group with access to all builds exists for the app and has all admin users invited to it.
 * This allows users to instantly access their builds from TestFlight after it finishes processing.
 */
export async function ensureTestFlightGroupExistsAsync(app: App): Promise<void> {
  if (process.env.EAS_NO_AUTO_TESTFLIGHT_SETUP) {
    Log.debug('EAS_NO_AUTO_TESTFLIGHT_SETUP is set, skipping TestFlight setup');
    return;
  }

  const groups = await app.getBetaGroupsAsync({
    query: {
      includes: ['betaTesters'],
    },
  });

  if (groups.length > 0) {
    Log.debug(`Found ${groups.length} TestFlight groups`);
    Log.debug('Skipping creating a new TestFlight group');
    return;
  }

  const group = await ensureInternalGroupAsync({
    app,
    groups,
  });
  const users = await User.getAsync(app.context);
  const admins = users.filter(user => user.attributes.roles?.includes(UserRole.ADMIN));

  await addAllUsersToInternalGroupAsync(group, admins);
}

async function ensureInternalGroupAsync({
  groups,
  app,
}: {
  groups: BetaGroup[];
  app: App;
}): Promise<BetaGroup> {
  let betaGroup = groups.find(group => group.attributes.name === AUTO_GROUP_NAME);
  if (!betaGroup) {
    const spinner = ora().start('Creating TestFlight group...');

    try {
      // Apple throw an error if you create the group too quickly after creating the app. We'll retry a few times.
      await pollRetryAsync(
        async () => {
          betaGroup = await app.createBetaGroupAsync({
            name: AUTO_GROUP_NAME,
            isInternalGroup: true,
            // Automatically add latest builds to the group without needing to run the command.
            hasAccessToAllBuilds: true,
          });
        },
        {
          shouldRetry(error) {
            if (isAppleError(error)) {
              spinner.text = `TestFlight not ready, retrying in 25 seconds...`;

              return error.data.errors.some(
                error => error.code === 'ENTITY_ERROR.RELATIONSHIP.INVALID'
              );
            }
            return false;
          },
        }
      );
      spinner.succeed(`TestFlight group created: ${AUTO_GROUP_NAME}`);
    } catch (error: any) {
      spinner.fail('Failed to create TestFlight group...');

      throw error;
    }
  }
  if (!betaGroup) {
    throw new Error('Failed to create internal TestFlight group');
  }

  // `hasAccessToAllBuilds` is a newer feature that allows the group to automatically have access to all builds. This cannot be patched so we need to recreate the group.
  if (!betaGroup.attributes.hasAccessToAllBuilds) {
    if (
      await confirmAsync({
        message: 'Regenerate internal TestFlight group to allow automatic access to all builds?',
      })
    ) {
      await BetaGroup.deleteAsync(app.context, { id: betaGroup.id });
      return await ensureInternalGroupAsync({
        app,
        groups: await app.getBetaGroupsAsync({
          query: {
            includes: ['betaTesters'],
          },
        }),
      });
    }
  }

  return betaGroup;
}

async function addAllUsersToInternalGroupAsync(group: BetaGroup, users: User[]): Promise<void> {
  let emails = users
    .filter(user => user.attributes.email)
    .map(user => ({
      email: user.attributes.email!,
      firstName: user.attributes.firstName ?? '',
      lastName: user.attributes.lastName ?? '',
    }));

  const { betaTesters } = group.attributes;
  const existingEmails = betaTesters?.map(tester => tester.attributes.email).filter(Boolean) ?? [];
  // Filter out existing beta testers.
  if (betaTesters) {
    emails = emails.filter(
      user => !existingEmails.find(existingEmail => existingEmail === user.email)
    );
  }

  // No new users to add to the internal group.
  if (!emails.length) {
    // No need to log which users are here on subsequent runs as devs already know the drill at this point.
    Log.debug(`All current admins are already added to the group: ${group.attributes.name}`);
    return;
  }

  Log.debug(`Adding ${emails.length} users to internal group: ${group.attributes.name}`);
  Log.debug(`Users: ${emails.map(user => user.email).join(', ')}`);

  const data = await group.createBulkBetaTesterAssignmentsAsync(emails);

  const success = data.attributes.betaTesters.every(tester => {
    if (tester.assignmentResult === 'FAILED') {
      if (tester.errors && Array.isArray(tester.errors) && tester.errors.length) {
        if (
          tester.errors.length === 1 &&
          tester.errors[0].key === 'Halliday.tester.already.exists'
        ) {
          return true;
        }
        for (const error of tester.errors) {
          Log.error(
            `Error adding user ${tester.email} to TestFlight group "${group.attributes.name}": ${error.key}`
          );
        }
      }
      return false;
    }
    if (tester.assignmentResult === 'NOT_QUALIFIED_FOR_INTERNAL_GROUP') {
      return false;
    }
    return true;
  });

  if (!success) {
    const groupUrl = await getTestFlightGroupUrlAsync(group);

    Log.error(
      `Unable to add all admins to TestFlight group "${
        group.attributes.name
      }". You can add them manually in App Store Connect. ${groupUrl ?? ''}`
    );
  } else {
    Log.log(
      `TestFlight access enabled for: ` +
        data.attributes.betaTesters
          .map(tester => tester.email)
          .filter(Boolean)
          .join(', ')
    );
    // TODO: When we have more TestFlight functionality, we can link to it from here.
  }
}

async function getTestFlightGroupUrlAsync(group: BetaGroup): Promise<string | null> {
  if (group.context.providerId) {
    try {
      const session = await Session.getSessionForProviderIdAsync(group.context.providerId);

      return `https://appstoreconnect.apple.com/teams/${session.provider.publicProviderId}/apps/6741088859/testflight/groups/${group.id}`;
    } catch (error) {
      // Avoid crashing if we can't get the session.
      Log.debug('Failed to get session for provider ID', error);
    }
  }
  return null;
}

async function pollRetryAsync<T>(
  fn: () => Promise<T>,
  {
    shouldRetry,
    retries = 10,
    // 25 seconds was the minium interval I calculated when measuring against 5 second intervals.
    interval = 25000,
  }: { shouldRetry?: (error: Error) => boolean; retries?: number; interval?: number } = {}
): Promise<T> {
  let lastError: Error | null = null;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      if (shouldRetry && !shouldRetry(error)) {
        throw error;
      }
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, interval));
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-throw-literal
  throw lastError;
}
