import chalk from 'chalk';
import indentString from 'indent-string';
import qrcodeTerminal from 'qrcode-terminal';
import { URL } from 'url';

import { getExpoWebsiteBaseUrl } from '../../../api';
import { AppleDeviceRegistrationRequestMutation } from '../../../credentials/ios/api/graphql/mutations/AppleDeviceRegistrationRequestMutation';
import { AppleTeam } from '../../../graphql/generated';
import Log from '../../../log';

export async function runRegistrationUrlMethodAsync(
  accountId: string,
  appleTeam: Pick<AppleTeam, 'id'>
): Promise<void> {
  const registrationURL = await generateDeviceRegistrationURLAsync(accountId, appleTeam);
  Log.newLine();
  qrcodeTerminal.generate(registrationURL, code => console.log(`${indentString(code, 2)}\n`));
  Log.log(
    'Open the following link on your iOS devices (or scan the QR code) and follow the instructions to install the development profile:'
  );
  Log.newLine();
  Log.log(chalk.green(`${registrationURL}`));
}

async function generateDeviceRegistrationURLAsync(
  accountId: string,
  appleTeam: Pick<AppleTeam, 'id'>
) {
  const appleDeviceRegistrationRequest = await AppleDeviceRegistrationRequestMutation.createAppleDeviceRegistrationRequestAsync(
    appleTeam.id,
    accountId
  );
  return formatRegistrationURL(appleDeviceRegistrationRequest.id);
}

function formatRegistrationURL(id: string): string {
  return new URL(`/register-device/${id}`, getExpoWebsiteBaseUrl()).toString();
}
