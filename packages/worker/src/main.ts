import { RuntimeSettings } from '@expo/build-tools';

import config from './config';
import logger from './logger';
import { startServer } from './metricsServer';
import { prepareRuntimeEnvironmentConfigFiles } from './runtimeEnvironment';
import sentry from './sentry';
import { prepareWorkingdir } from './workingdir';
import startWsServer from './ws';

async function main(): Promise<void> {
  await RuntimeSettings.loadAsync({
    environment: config.env,
    logger,
    cacheUrlFallbacks: {
      npm: config.npmCacheUrl,
      nodejs: config.nodeJsCacheUrl,
      maven: config.mavenCacheUrl,
      cocoapods: config.cocoapodsCacheUrl,
    },
  });
  await prepareRuntimeEnvironmentConfigFiles();
  await prepareWorkingdir();
  startWsServer();
  if (config.runMetricsServer) {
    startServer();
  }
  // for pm2
  if (config.env === 'development' && process.send) {
    process.send('ready');
  }
}

main().catch(async err => {
  logger.error({ err }, 'Something went wrong.');
  try {
    await sentry.flush();
  } catch (flushErr) {
    logger.error({ err: flushErr }, 'Failed to flush Sentry before exit');
  }
  process.exit(1);
});
