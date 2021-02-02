import assert from 'assert';
import chalk from 'chalk';

import { apiClient } from '../api';
import Log from '../log';
import { promptAsync, selectAsync } from '../prompts';
import { loginAsync } from './User';

export enum UserSecondFactorDeviceMethod {
  AUTHENTICATOR = 'authenticator',
  SMS = 'sms',
}

export type SecondFactorDevice = {
  id: string;
  method: UserSecondFactorDeviceMethod;
  sms_phone_number: string | null;
  is_primary: boolean;
};

/**
 * Prompt for an OTP with the option to cancel the question by answering empty (pressing return key).
 */
async function promptForOTPAsync(cancelBehavior: 'cancel' | 'menu'): Promise<string | null> {
  const enterMessage =
    cancelBehavior === 'cancel'
      ? `press ${chalk.bold('Enter')} to cancel`
      : `press ${chalk.bold('Enter')} for more options`;
  const { otp } = await promptAsync({
    type: 'text',
    name: 'otp',
    message: `One-time password or backup code (${enterMessage}):`,
  });
  if (!otp) {
    return null;
  }

  return otp;
}

/**
 * Prompt for user to choose a backup OTP method. If selected method is SMS, a request
 * for a new OTP will be sent to that method. Then, prompt for the OTP, and retry the user login.
 */
async function promptForBackupOTPAsync(
  username: string,
  password: string,
  secondFactorDevices: SecondFactorDevice[]
): Promise<string | null> {
  const nonPrimarySecondFactorDevices = secondFactorDevices.filter(device => !device.is_primary);

  if (nonPrimarySecondFactorDevices.length === 0) {
    throw new Error(
      'No other second-factor devices set up. Ensure you have set up and certified a backup device.'
    );
  }

  const hasAuthenticatorSecondFactorDevice = nonPrimarySecondFactorDevices.find(
    device => device.method === UserSecondFactorDeviceMethod.AUTHENTICATOR
  );

  const smsNonPrimarySecondFactorDevices = nonPrimarySecondFactorDevices.filter(
    device => device.method === UserSecondFactorDeviceMethod.SMS
  );

  const authenticatorChoiceSentinel = -1;
  const cancelChoiceSentinel = -2;

  const deviceChoices = smsNonPrimarySecondFactorDevices.map((device, idx) => ({
    title: device.sms_phone_number!,
    value: idx,
  }));

  if (hasAuthenticatorSecondFactorDevice) {
    deviceChoices.push({
      title: 'Authenticator',
      value: authenticatorChoiceSentinel,
    });
  }

  deviceChoices.push({
    title: 'Cancel',
    value: cancelChoiceSentinel,
  });

  const selectedValue = await selectAsync('Select a second-factor device:', deviceChoices);
  if (selectedValue === cancelChoiceSentinel) {
    return null;
  } else if (selectedValue === authenticatorChoiceSentinel) {
    return await promptForOTPAsync('cancel');
  }

  const device = smsNonPrimarySecondFactorDevices[selectedValue];

  await apiClient
    .post('auth/send-sms-otp', {
      json: {
        username,
        password,
        secondFactorDeviceID: device.id,
      },
    })
    .json();

  return await promptForOTPAsync('cancel');
}

/**
 * Handle the special case error indicating that a second-factor is required for
 * authentication.
 *
 * There are three cases we need to handle:
 * 1. User's primary second-factor device was SMS, OTP was automatically sent by the server to that
 *    device already. In this case we should just prompt for the SMS OTP (or backup code), which the
 *    user should be receiving shortly. We should give the user a way to cancel and the prompt and move
 *    to case 3 below.
 * 2. User's primary second-factor device is authenticator. In this case we should prompt for authenticator
 *    OTP (or backup code) and also give the user a way to cancel and move to case 3 below.
 * 3. User doesn't have a primary device or doesn't have access to their primary device. In this case
 *    we should show a picker of the SMS devices that they can have an OTP code sent to, and when
 *    the user picks one we show a prompt() for the sent OTP.
 */
export async function retryUsernamePasswordAuthWithOTPAsync(
  username: string,
  password: string,
  metadata: {
    secondFactorDevices?: SecondFactorDevice[];
    smsAutomaticallySent?: boolean;
  }
): Promise<void> {
  const { secondFactorDevices, smsAutomaticallySent } = metadata;
  assert(
    secondFactorDevices !== undefined && smsAutomaticallySent !== undefined,
    `Malformed OTP error metadata: ${metadata}`
  );

  const primaryDevice = secondFactorDevices.find(device => device.is_primary);
  let otp: string | null = null;

  if (smsAutomaticallySent) {
    assert(primaryDevice, 'OTP should only automatically be sent when there is a primary device');
    Log.log(
      `One-time password was sent to the phone number ending in ${primaryDevice.sms_phone_number}.`
    );
    otp = await promptForOTPAsync('menu');
  }

  if (primaryDevice?.method === UserSecondFactorDeviceMethod.AUTHENTICATOR) {
    Log.log('One-time password from authenticator required.');
    otp = await promptForOTPAsync('menu');
  }

  // user bailed on case 1 or 2, wants to move to case 3
  if (!otp) {
    otp = await promptForBackupOTPAsync(username, password, secondFactorDevices);
  }

  if (!otp) {
    throw new Error('Cancelled login');
  }

  await loginAsync({
    username,
    password,
    otp,
  });
}
