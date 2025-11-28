import { hostname } from 'os';
import url from 'url';

import { WebSocketServer, LauncherMessage } from '@expo/turtle-common';
import { WebSocketServer as WSServer, WebSocket } from 'ws';

import config, { Environment } from './config';
import logger from './logger';
import sentry from './sentry';
import BuildService from './service';

function startWsServer(port = config.port): WSServer {
  const service = new BuildService();
  const ws = new WSServer({ port });
  logger.info(`Starting WebSocket server on port ${port}`);

  ws.on('connection', (socket, req) => {
    const parsedUrl = url.parse(req.url ?? '', true);
    const vmName = parsedUrl.query['expo_vm_name'] as string;

    if (config.env !== Environment.DEVELOPMENT && !hostname().startsWith(vmName)) {
      socket.close(1008, 'Unauthorized');
      return;
    }

    handleConnection(socket, service);
  });
  return ws;
}

function handleConnection(socket: WebSocket, service: BuildService): void {
  if (service.isConnected) {
    socket.close();
    return;
  }

  const wsServer = new WebSocketServer(socket);

  service.setWS(wsServer);

  wsServer.onError((err: Error) => {
    sentry.handleError('WebSocket error', err);
  });

  wsServer.onMessage((message: LauncherMessage.Message) => {
    try {
      logger.debug({ message }, 'WebSocket message received');
      const { handled } = handleMessage(service, message) || { handled: false };
      if (!handled) {
        throw new Error(
          `Unknown message type received from launcher\n${JSON.stringify(message, null, 2)}`
        );
      }
    } catch (err: any) {
      sentry.handleError('Unhandled WebSocket message', err);
    }
  });

  wsServer.onClose(() => {
    logger.info('Closing WebSocket connection');
    if (service.shouldClose && config.env !== 'test') {
      process.exit(0);
    } else {
      service.setWS(null);
    }
  });
}

function handleMessage(
  service: BuildService,
  message: LauncherMessage.Message
): { handled: boolean } {
  switch (message.type) {
    case LauncherMessage.MessageType.STATE_QUERY:
      service.syncLauncherState(message);
      return { handled: true };

    case LauncherMessage.MessageType.DISPATCH:
      service.startBuild(message);
      return { handled: true };

    case LauncherMessage.MessageType.CLOSE:
      service.closeWorker();
      return { handled: true };

    case LauncherMessage.MessageType.ABORT:
      void service.finishAbort(message);
      return { handled: true };
  }
}

export default startWsServer;
