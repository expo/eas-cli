import chalk from 'chalk';
import indentString from 'indent-string';
import qrcodeTerminal from 'qrcode-terminal';
import { URL } from 'url';

import { getExpoWebsiteBaseUrl } from '../../../api';
import { AppleDeviceRegistrationRequestMutation } from '../../../graphql/mutations/credentials/AppleDeviceRegistrationRequestMutation';
import { AppleTeam } from '../../../graphql/types/credentials/AppleTeam';
import log from '../../../log';

export async function runRegistrationUrlMethodAsync(
  accountId: string,
  appleTeam: AppleTeam
): Promise<void> {
  const registrationURL = await generateDeviceRegistrationURLAsync(accountId, appleTeam);
  log.newLine();
  qrcodeTerminal.generate(registrationURL, code => console.log(`${indentString(code, 2)}\n`));
  log(
    'Open the following link on your iOS devices (or scan the QR code) and follow the instructions to install the development profile:'
  );
  log.newLine();
  log(chalk.green(`${registrationURL}`));
}

async function generateDeviceRegistrationURLAsync(accountId: string, appleTeam: AppleTeam) {
  const appleDeviceRegistrationRequest = await AppleDeviceRegistrationRequestMutation.createAppleDeviceRegistrationRequestAsync(
    appleTeam.id,
    accountId
  );
  return formatRegistrationURL(appleDeviceRegistrationRequest.id);
}

function formatRegistrationURL(id: string): string {
  return new URL(`/register-device/${id}`, getExpoWebsiteBaseUrl()).toString();
}
