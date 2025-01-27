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

  return {
    ascAppIdentifier: app.id,
  };
}

const AUTO_GROUP_NAME = 'Internal (Expo)';

async function ensureInternalGroupAsync(app: App): Promise<BetaGroup> {
  const groups = await app.getBetaGroupsAsync({
    query: {
      includes: ['betaTesters'],
    },
  });

  let betaGroup = groups.find(group => group.attributes.name === AUTO_GROUP_NAME);

  if (!betaGroup) {
    betaGroup = await app.createBetaGroupAsync({
      name: AUTO_GROUP_NAME,
      publicLinkEnabled: false,
      publicLinkLimitEnabled: false,
      isInternalGroup: true,
      // Automatically add latest builds to the group without needing to run the command.
      hasAccessToAllBuilds: true,
    });
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

  if (!betaGroup.attributes.isInternalGroup || !betaGroup.attributes.feedbackEnabled) {
    await betaGroup.updateAsync({
      isInternalGroup: true,
      feedbackEnabled: true,
    });
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
      if (tester.errors) {
        if (
          tester.errors.length === 1 &&
          tester.errors[0].key === 'Halliday.tester.already.exists'
        ) {
          return true;
        }
        for (const error of tester.errors) {
          Log.error(`Failed to add ${tester.email}: ${error.key}`);
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
    Log.error('Failed to add all TestFlight users to internal group.');
  }
}
