import config from './config';
import Sentry from './external/sentry';
import logger from './logger';

export default new Sentry({
  dsn: config.sentry.dsn,
  environment: config.env,
  tags: {
    service: `worker:${process.platform}`,
  },
  logger,
});
