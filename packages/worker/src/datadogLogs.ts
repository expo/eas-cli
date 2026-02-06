import config from './config';
import DatadogLogs from './external/datadogLogs';
import logger from './logger';

export default new DatadogLogs({
  apiKey: config.datadog.apiKey,
  site: config.datadog.site,
  service: `worker:${process.platform}`,
  logger,
});
