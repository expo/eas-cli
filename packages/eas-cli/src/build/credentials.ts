import { Platform } from '@expo/eas-build-job';
import { CredentialsSource } from '@expo/eas-json';
import chalk from 'chalk';

import { CredentialsProvider } from '../credentials/CredentialsProvider';
import Log from '../log';
import { requestedPlatformDisplayNames } from './constants';

export function resolveCredentialsSource(
  provider: CredentialsProvider,
  src: CredentialsSource
): CredentialsSource.LOCAL | CredentialsSource.REMOTE {
  switch (src) {
    case CredentialsSource.LOCAL:
      logCredentials('local', provider.platform);
      return CredentialsSource.LOCAL;
    case CredentialsSource.AUTO:
      Log.warn(`"credentialsSource": "auto" is deprecated, using "remote" instead`);
      logCredentials('remote', provider.platform);
      return CredentialsSource.REMOTE;
    case CredentialsSource.REMOTE:
      logCredentials('remote', provider.platform);
      return CredentialsSource.REMOTE;
  }
}

function logCredentials(target: 'local' | 'remote', platform: Platform) {
  let message = `Using ${target} ${requestedPlatformDisplayNames[platform]} credentials`;
  if (target === 'local') message += ` ${chalk.dim('(credentials.json)')}`;
  if (target === 'remote') message += ` ${chalk.dim('(Expo server)')}`;
  Log.succeed(message);
}
