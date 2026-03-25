import * as Sentry from '@sentry/node';

import { easCliVersion } from './utils/easCli';

Sentry.init({
  dsn: process.env.EAS_CLI_SENTRY_DSN,
  enabled: !!process.env.EAS_CLI_SENTRY_DSN,
  environment: getSentryEnvironment(),
  release: easCliVersion ? `eas-cli@${easCliVersion}` : undefined,
});
Sentry.setTag('source', 'eas-cli');

function getSentryEnvironment(): string {
  if (process.env.EXPO_LOCAL) {
    return 'local';
  } else if (process.env.EXPO_STAGING) {
    return 'staging';
  }
  return 'production';
}

export default Sentry;
