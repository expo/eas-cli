import { LoggedInAuthenticationInfo } from './SessionManager';
import { ApiV2Error } from '../ApiV2Error';
import { ApiV2Client } from '../api';
import { GraphqlError } from '../graphql/client';
import Log from '../log';
import { promptAsync } from '../prompts';

export const SUDO_MODE_REQUIRED_ERROR_CODE = 'SUDO_MODE_REQUIRED';

/**
 * Whether the error is the server signaling that the current session must be upgraded
 * to sudo mode before performing this operation.
 */
export function isSudoModeRequiredError(error: unknown): boolean {
  return (
    error instanceof GraphqlError &&
    error.graphQLErrors.some(e => e?.extensions?.errorCode === SUDO_MODE_REQUIRED_ERROR_CODE)
  );
}

/**
 * Upgrade the current session to sudo mode by re-confirming the user's password
 * (and OTP if two-factor authentication is enabled). Sudo mode is required for
 * destructive operations like project deletion, and expires server-side after a
 * few minutes.
 */
export async function promptForSudoModeUpgradeAsync(
  authenticationInfo: LoggedInAuthenticationInfo
): Promise<void> {
  if (!authenticationInfo.sessionSecret) {
    throw new Error(
      'This action requires sudo mode, which is only available for user sessions. ' +
        'Access tokens (EXPO_TOKEN) cannot be upgraded to sudo mode; log in with `eas login` instead.'
    );
  }

  Log.log('This action requires sudo mode. Confirm your password to continue.');
  const { password } = await promptAsync({
    type: 'password',
    name: 'password',
    message: 'Password:',
  });
  if (!password) {
    throw new Error('Password is required for sudo mode.');
  }

  const apiV2Client = new ApiV2Client(authenticationInfo);
  try {
    await apiV2Client.postAsync('auth/upgradeSudo', { body: { password } });
  } catch (error) {
    if (error instanceof ApiV2Error && error.expoApiV2ErrorCode === 'ONE_TIME_PASSWORD_REQUIRED') {
      Log.log('One-time password from authenticator required.');
      const { otp } = await promptAsync({
        type: 'text',
        name: 'otp',
        message: 'One-time password or backup code:',
      });
      if (!otp) {
        throw new Error('Cancelled sudo mode upgrade.');
      }
      await apiV2Client.postAsync('auth/upgradeSudo', { body: { password, otp } });
    } else {
      throw error;
    }
  }
}
