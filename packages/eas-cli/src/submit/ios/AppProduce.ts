import { App, BetaGroup, RequestContext, Session, User, UserRole } from '@expo/apple-utils';
import { Platform } from '@expo/eas-build-job';
import chalk from 'chalk';

import { sanitizeLanguage } from './utils/language';
import { getRequestContext } from '../../credentials/ios/appstore/authenticate';
import {
  ensureAppExistsAsync,
  ensureBundleIdExistsWithNameAsync,
} from '../../credentials/ios/appstore/ensureAppExists';
import Log from '../../log';
import { ora } from '../../ora';
import { getBundleIdentifierAsync } from '../../project/ios/bundleIdentifier';
import { confirmAsync, promptAsync } from '../../prompts';
import { SubmissionContext } from '../context';

interface CreateAppOptions {
  appleId?: string;
  appName: string;
  bundleIdentifier: string;
  appleTeamId?: string;
  language?: string;
  companyName?: string;
  sku?: string;
}

type AppStoreResult = {
  ascAppIdentifier: string;
};

export async function ensureAppStoreConnectAppExistsAsync(
  ctx: SubmissionContext<Platform.IOS>
): Promise<AppStoreResult> {
  const { exp } = ctx;
  const { appName, language } = ctx.profile;
  const options = {
    ...ctx.profile,
    bundleIdentifier:
      ctx.applicationIdentifierOverride ??
      ctx.profile.bundleIdentifier ??
      (await getBundleIdentifierAsync(ctx.projectDir, exp, ctx.vcsClient)),
    appName: appName ?? exp.name ?? (await promptForAppNameAsync()),
    language: sanitizeLanguage(language),
  };
  return await createAppStoreConnectAppAsync(ctx, options);
}

async function isProvisioningAvailableAsync(requestCtx: RequestContext): Promise<boolean> {
  const session = Session.getAnySessionInfo();
  // TODO: Investigate if username and email can be different
  const username = session?.user.emailAddress;
  const [user] = await User.getAsync(requestCtx, { query: { filter: { username } } });
  return user.attributes.provisioningAllowed;
}

async function createAppStoreConnectAppAsync(
  ctx: SubmissionContext<Platform.IOS>,
  options: CreateAppOptions
): Promise<AppStoreResult> {
  const {
    appleId,
    appleTeamId,
    bundleIdentifier: bundleId,
    appName,
    language,
    companyName,
    sku,
  } = options;

  const userAuthCtx = await ctx.credentialsCtx.appStore.ensureUserAuthenticatedAsync({
    appleId,
    teamId: appleTeamId,
  });
  const requestCtx = getRequestContext(userAuthCtx);

  Log.addNewLineIfNone();

  if (await isProvisioningAvailableAsync(requestCtx)) {
    await ensureBundleIdExistsWithNameAsync(userAuthCtx, {
      name: appName,
      bundleIdentifier: bundleId,
    });
  } else {
    Log.warn(
      `Provisioning is not available for Apple User: ${userAuthCtx.appleId}, skipping bundle identifier check.`
    );
  }

  let app: App | null = null;

  try {
    app = await ensureAppExistsAsync(userAuthCtx, {
      name: appName,
      language,
      companyName,
      bundleIdentifier: bundleId,
      sku,
    });
  } catch (error: any) {
    if (
      // Name is invalid
      error.message.match(
        /App Name contains certain Unicode(.*)characters that are not permitted/
      ) ||
      // UnexpectedAppleResponse: An attribute value has invalid characters. - App Name contains certain Unicode symbols, emoticons, diacritics, special characters, or private use characters that are not permitted.
      // Name is taken
      error.message.match(/The App Name you entered is already being used/)
      // UnexpectedAppleResponse: The provided entity includes an attribute with a value that has already been used on a different account. - The App Name you entered is already being used. If you have trademark rights to
      // this name and would like it released for your use, submit a claim.
    ) {
      Log.addNewLineIfNone();
      Log.warn(
        `Change the name in your app config, or use a custom name with the ${chalk.bold(
          '--app-name'
        )} flag`
      );
      Log.newLine();
    }
    throw error;
  }

  try {
    // Ensure the app has an internal TestFlight group with access to all builds and app managers added.
    const max = false;

    const group = await ensureInternalGroupAsync(app);

    const admins = await User.getAsync(
      app.context,
      !max
        ? undefined
        : // Querying all visible apps for all users can be expensive so we only do it when there's a chance we may need to reconcile.
          {
            query: {
              includes: ['visibleApps'],
            },
          }
    );

    await addAllUsersToInternalGroupAsync(
      app,
      group,
      max ? admins : admins.filter(user => user.attributes.roles?.includes(UserRole.ADMIN)),
      max
    );
  } catch (error: any) {
    // This process is not critical to the app submission so we shouldn't let it fail the entire process.
    Log.error(
      'Failed to create an internal TestFlight group. This can be done manually in App Store Connect.'
    );
    Log.error(error);

    // Debug
    // throw error;
  }

  // process.exit(0);

  return {
    ascAppIdentifier: app.id,
  };
}

const AUTO_GROUP_NAME = 'Team (Expo)';

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

async function promptForAppNameAsync(): Promise<string> {
  const { appName } = await promptAsync({
    type: 'text',
    name: 'appName',
    message: 'What would you like to name your app?',
    validate: (val: string) => val !== '' || 'App name cannot be empty!',
  });
  return appName;
}

async function addAllUsersToInternalGroupAsync(
  app: App,
  group: BetaGroup,
  users: User[],
  shouldAddUsers = true
): Promise<void> {
  let emails = users
    .map(user => ({
      email: user.attributes.email ?? '',
      firstName: user.attributes.firstName ?? '',
      lastName: user.attributes.lastName ?? '',
    }))
    .filter(user => user.email);

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

  const needsQualification = data.attributes.betaTesters.filter(tester => {
    if (tester.assignmentResult === 'NOT_QUALIFIED_FOR_INTERNAL_GROUP') {
      return true;
    }
    return false;
  });

  // Reconcile users that need qualification (non-admins).
  if (needsQualification.length) {
    Log.debug('Some users need to be qualified for internal group.');
    Log.debug(needsQualification);

    const matchingUsers = users.filter(user => {
      return needsQualification.find(tester => tester.email === user.attributes.email);
    });

    if (shouldAddUsers) {
      Log.debug('Matching users:', matchingUsers);

      await Promise.all(
        matchingUsers.map(user => {
          if (!user.attributes.visibleApps) {
            // Shouldn't happen. But this prevents removing all apps from a user accidentally.
            throw new Error('User is missing visibleApps attribute');
          }

          return user.updateAsync(user.attributes, {
            visibleApps: [...user.attributes.visibleApps!.map(app => app.id), app.id],
          });
        })
      );

      await addAllUsersToInternalGroupAsync(app, group, users, false);
      return;
    }
  }

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
