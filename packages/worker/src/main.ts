import config from './config';
import logger from './logger';
import { startServer } from './metricsServer';
import { prepareRuntimeEnvironmentConfigFiles } from './runtimeEnvironment';
import { prepareWorkingdir } from './workingdir';
import startWsServer from './ws';

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

main().catch(err => {
  logger.error({ err }, 'Something went wrong.');
  process.exit(1);
});
