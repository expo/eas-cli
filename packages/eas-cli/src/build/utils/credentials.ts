import { Platform } from '@expo/eas-build-job';
import { CredentialsSource } from '@expo/eas-json';
import chalk from 'chalk';

import Log from '../../log';
import { requestedPlatformDisplayNames } from '../constants';

export function logCredentialsSource(credentialsSource: CredentialsSource, platform: Platform) {
  let message = `Using ${credentialsSource} ${requestedPlatformDisplayNames[platform]} credentials`;
  if (credentialsSource === CredentialsSource.LOCAL) {
    message += ` ${chalk.dim('(credentials.json)')}`;
  } else if (credentialsSource === CredentialsSource.REMOTE) {
    message += ` ${chalk.dim('(Expo server)')}`;
  }
  Log.succeed(message);
}
