import config from './config';
import { startXcodeBuildToolsPrewarming } from './ios/prewarmXcodeBuildTools';
import logger from './logger';
import { startServer } from './metricsServer';
import sentry from './sentry';
import { prepareWorkingdir } from './workingdir';
import startWsServer from './ws';

async function main(): Promise<void> {
  void startXcodeBuildToolsPrewarming({ env: process.env, logger });
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
