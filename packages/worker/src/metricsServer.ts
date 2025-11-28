import { Server } from 'http';

import { ExitHandler, koaUtils } from '@expo/turtle-common';
import Koa from 'koa';
import koaBody from 'koa-body';
import Router from 'koa-router';

import config from './config';
import logger from './logger';
import { getWorkerVmMetrics } from './metrics';

function createRouter(): Router {
  const router = new Router();

  router.get('/metrics', async (ctx: Router.RouterContext): Promise<void> => {
    logger.info('Get VM metrics request received');
    ctx.status = 200;
    ctx.body = await getWorkerVmMetrics();
    logger.info('Get VM metrics request handled');
  });
  return router;
}

function createApp(): Koa {
  const app = new Koa();
  const router = createRouter();
  app.use(koaUtils.errorMiddleware);
  app.use(koaBody());
  app.use(router.routes());
  app.use(router.allowedMethods());
  return app;
}

export function startServer(): Server {
  const app = createApp();
  const server = app.listen(config.metricsServerPort);
  server.on('error', (err) => {
    logger.error({ err }, 'http.Server error');
  });
  logger.info(`Metrics HTTP server is listening on port ${config.metricsServerPort}`);
  ExitHandler.registerHandler(() => {
    server.close();
  });
  return server;
}
