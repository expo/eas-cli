import { Sentry } from '@expo/turtle-common';

import config from './config';
import logger from './logger';

export default new Sentry({
  dsn: config.sentry.dsn,
  environment: config.env,
  tags: {
    service: `worker:${process.platform}`,
  },
  logger,
});
