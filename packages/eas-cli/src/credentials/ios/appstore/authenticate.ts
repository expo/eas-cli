import {
  Auth,
  InvalidUserCredentialsError,
  RequestContext,
  Session,
  Teams,
  Token,
} from '@expo/apple-utils';
import assert from 'assert';
import chalk from 'chalk';
import * as getenv from 'getenv';

import {
  ApiKeyAuthCtx,
  AppleTeamType,
  AuthCtx,
  AuthenticationMode,
  Team,
  UserAuthCtx,
} from './authenticateTypes';
import {
  deletePasswordAsync,
  promptPasswordAsync,
  resolveAppleTeamAsync,
  resolveAscApiKeyAsync,
  resolveUserCredentialsAsync,
} from './resolveCredentials';
import Log from '../../../log';
import { toggleConfirmAsync } from '../../../prompts';
import { MinimalAscApiKey } from '../credentials';

const APPLE_IN_HOUSE_TEAM_TYPE = 'in-house';

export type Options = {
  appleId?: string;
  teamId?: string;
  teamName?: string;
  teamType?: AppleTeamType;
  ascApiKey?: MinimalAscApiKey;
  /**
   * Can be used to restore the Apple auth state via apple-utils.
   */
  cookies?: Session.AuthState['cookies'];
  /** Indicates how Apple network requests will be made. */
  mode?: AuthenticationMode;
};

export function isUserAuthCtx(authCtx: AuthCtx | undefined): authCtx is UserAuthCtx {
  return !!authCtx && typeof (authCtx as UserAuthCtx).appleId === 'string';
}

export function assertUserAuthCtx(authCtx: AuthCtx | undefined): UserAuthCtx {
  if (isUserAuthCtx(authCtx)) {
    return authCtx;
  }
  throw new Error('Expected user authentication context (login/password).');
}

export function getRequestContext(authCtx: AuthCtx): RequestContext {
  assert(authCtx.authState?.context, 'Apple request context must be defined');
  return authCtx.authState.context;
}

async function loginAsync(
  userCredentials: Partial<Auth.UserCredentials> = {},
  options: Auth.LoginOptions
): Promise<Session.AuthState> {
  // First try login with cookies JSON
  if (userCredentials.cookies) {
    const session = await Auth.loginWithCookiesAsync(userCredentials);
    // If the session isn't valid, continue to the other authentication methods.
    // Use `loginWithCookiesAsync` for a less resilient flow.
    if (session) {
      return session;
    }
  }

  // Resolve the user credentials, optimizing for password-less login.
  const { username, password } = await resolveUserCredentialsAsync(userCredentials);
  assert(username);

  // Clear data
  Auth.resetInMemoryData();

  try {
    // Attempt to rehydrate the session.
    const restoredSession = await Auth.tryRestoringAuthStateFromUserCredentialsAsync(
      {
        username,
        providerId: userCredentials.providerId,
        teamId: userCredentials.teamId,
      },
      options
    );
    if (restoredSession) {
      // Completed authentication!
      return { password, ...restoredSession };
    }

    return await loginWithUserCredentialsAsync({
      username,
      password,
      providerId: userCredentials.providerId,
      teamId: userCredentials.teamId,
    });
  } catch (error) {
    if (error instanceof InvalidUserCredentialsError) {
      Log.error(error.message);
      // Remove the invalid password so it isn't automatically used...
      await deletePasswordAsync({ username });

      if (await toggleConfirmAsync({ message: 'Would you like to try again?' })) {
        // Don't pass credentials back or the method will throw
        return await loginAsync(
          {
            teamId: userCredentials.teamId,
            providerId: userCredentials.providerId,
          },
          options
        );
      } else {
        throw new Error('ABORTED');
      }
    }
    throw error;
  }
}

async function loginWithUserCredentialsAsync({
  username,
  password,
  teamId,
  providerId,
}: {
  username: string;
  password?: string;
  teamId?: string;
  providerId?: number;
}): Promise<Session.AuthState> {
  // Start a new login flow
  const newSession = await Auth.loginWithUserCredentialsAsync({
    username,
    // If the session couldn't be restored, then prompt for the password (also check if it's stored in the keychain).
    password: password || (await promptPasswordAsync({ username })),
    providerId,
    teamId,
  });
  // User cancelled or something.
  assert(newSession, 'An unexpected error occurred while completing authentication');

  // Success!
  return newSession;
}

export async function authenticateAsync(options: Options = {}): Promise<AuthCtx> {
  if (options.mode === AuthenticationMode.API_KEY) {
    return await authenticateWithApiKeyAsync(options);
  } else {
    return await authenticateAsUserAsync(options);
  }
}

async function authenticateWithApiKeyAsync(options: Options = {}): Promise<ApiKeyAuthCtx> {
  // Resolve the user credentials, optimizing for password-less login.
  const ascApiKey = await resolveAscApiKeyAsync(options.ascApiKey);
  const team = await resolveAppleTeamAsync(options);
  const jwtDurationSeconds = 1200; // 20 minutes
  return {
    team,
    authState: {
      context: {
        token: new Token({
          key: ascApiKey.keyP8,
          issuerId: ascApiKey.issuerId,
          keyId: ascApiKey.keyId,
          duration: jwtDurationSeconds,
        }),
      },
    },
    ascApiKey,
  };
}

async function authenticateAsUserAsync(options: Options = {}): Promise<AuthCtx> {
  // help keep apple login visually apart from the other operations.
  Log.addNewLineIfNone();

  try {
    const authState = await loginAsync(
      {
        cookies: options.cookies,
        teamId: options.teamId ?? process.env.EXPO_APPLE_TEAM_ID,
        providerId: process.env.EXPO_APPLE_PROVIDER_ID
          ? getenv.int('EXPO_APPLE_PROVIDER_ID')
          : undefined,
      },
      {
        // TODO: Provide a way to disable this for users who want to mix and match teams / providers.
        autoResolveProvider: true,
      }
    );

    // Currently, this is resolved once, inside the apple-utils package.
    const teamId = authState.context.teamId!;
    // Get all of the teams to resolve the rest of the user data.
    // TODO: optimize this step.
    const teams = await Teams.getTeamsAsync();
    const team = teams.find(team => team.teamId === teamId);
    assert(team, `Your account is not associated with Apple Team with ID: ${teamId}`);

    // Get the JSON cookies in the custom YAML format used by Fastlane
    const fastlaneSession = Session.getSessionAsYAML();
    return {
      appleId: authState.username,
      appleIdPassword: authState.password,
      team: formatTeam(team),
      // Can be used to restore the auth state using apple-utils.
      authState,
      // Defined for legacy usage in Turtle V1 or any other places where Fastlane is used in the servers.
      fastlaneSession,
    };
  } catch (error: any) {
    if (error.message === 'ABORTED') {
      process.exit(1);
    }
    Log.log(chalk.red('Authentication with Apple Developer Portal failed!'));
    throw error;
  }
}

function formatTeam({ teamId, name, type }: Teams.AppStoreTeam): Team {
  return {
    id: teamId,
    name: `${name} (${type})`,
    inHouse: type.toLowerCase() === APPLE_IN_HOUSE_TEAM_TYPE,
  };
}
