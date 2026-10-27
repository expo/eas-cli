import { Sentry } from '@expo/build-tools';

import config from './config';

Sentry.setup({
  // SENTRY_DSN defaults to '' in config; coerce to null so Sentry.setup skips SDK init.
  dsn: config.sentry.dsn || null,
  environment: config.env,
  tags: {
    service: `worker:${process.platform}`,
  },
});

export default Sentry;
