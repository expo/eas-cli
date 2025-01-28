import { App, BetaGroup, Session, User, UserRole } from '@expo/apple-utils';

import Log from '../../../log';
import { ora } from '../../../ora';
import { confirmAsync } from '../../../prompts';

// The name of the internal TestFlight group, this should probably never change.
const AUTO_GROUP_NAME = 'Team (Expo)';

export async function ensureTestFlightGroupExistsAsync(app: App): Promise<void> {
  const group = await ensureInternalGroupAsync(app);
  const users = await User.getAsync(app.context);
  const admins = users.filter(user => user.attributes.roles?.includes(UserRole.ADMIN));

  await addAllUsersToInternalGroupAsync(group, admins);
}

async function ensureInternalGroupAsync(app: App): Promise<BetaGroup> {
  const groups = await app.getBetaGroupsAsync({
    query: {
      includes: ['betaTesters'],
    },
  });

  let betaGroup = groups.find(group => group.attributes.name === AUTO_GROUP_NAME);
  if (!betaGroup) {
    const spinner = ora().start('Creating TestFlight group...');

    try {
      // Apple throw an error if you create the group too quickly after creating the app. We'll retry a few times.
      await pollRetryAsync(
        async () => {
          betaGroup = await app.createBetaGroupAsync({
            name: AUTO_GROUP_NAME,
            publicLinkEnabled: false,
            publicLinkLimitEnabled: false,
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
      return await ensureInternalGroupAsync(app);
    }
  }

  return betaGroup;
}

async function addAllUsersToInternalGroupAsync(group: BetaGroup, users: User[]): Promise<void> {
  let emails = users
    .map(user => ({
      email: user.attributes.email ?? '',
      firstName: user.attributes.firstName ?? '',
      lastName: user.attributes.lastName ?? '',
    }))
    .filter(user => user.email);

  // Filter out existing beta testers.
  if (group.attributes.betaTesters) {
    emails = emails.filter(user => {
      return !group.attributes.betaTesters!.find(tester => tester.attributes.email === user.email);
    });
  }

  if (!emails.length) {
    // No new users to add to the internal group.
    Log.debug('No new users to add to internal group');
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
      `Unable to add all developers to TestFlight internal group "${
        group.attributes.name
      }". You can add them manually in App Store Connect. ${groupUrl ?? ''}`
    );
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

function isAppleError(error: any): error is {
  data: {
    errors: {
      id: string;
      status: string;
      /** 'ENTITY_ERROR.ATTRIBUTE.INVALID.INVALID_CHARACTERS' */
      code: string;
      /** 'An attribute value has invalid characters.' */
      title: string;
      /** 'App Name contains certain Unicode symbols, emoticons, diacritics, special characters, or private use characters that are not permitted.' */
      detail: string;
    }[];
  };
} {
  return 'data' in error && 'errors' in error.data && Array.isArray(error.data.errors);
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
