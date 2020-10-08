import chalk from 'chalk';

import log from '../../../log';
import { Account } from '../../../user/Account';

export async function generateDeviceRegistrationURL(account: Account, appleTeamId: string) {
  log.error(
    `this will generate a URL for registering devices under account ${account.name} and apple team id ${appleTeamId}`
  );
  log.error(`but it's ${chalk.bold('not implemented yet')}`);
}
