import config from './config';
import logger from './logger';
import { prepareWorkingdir } from './workingdir';
import { prepareRuntimeEnvironmentConfigFiles } from './runtimeEnvironment';
import startWsServer from './ws';
import { startServer } from './metricsServer';

async function main(): Promise<void> {
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

main().catch((err) => {
  logger.error({ err }, 'Something went wrong.');
  process.exit(1);
});
