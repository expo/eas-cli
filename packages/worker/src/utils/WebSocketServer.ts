import WebSocket from 'ws';
import logger from '../logger';

const PING_TIMEOUT_MS = 10000;

class WebSocketBase<IncommingMessage, OutgoingMessage> {
  protected conn: WebSocket;
  private queue: (() => Promise<void> | void)[] = [];
  private draining = false;
  private onErrorCb?: (error: any) => Promise<void> | void;

  constructor(ws: WebSocket) {
    this.conn = ws;
    this.conn.on('error', error => {
      void this.handleError(error);
    });
  }

  public onMessage(cb: (msg: IncommingMessage) => Promise<void> | void): void {
    this.conn.on('message', (rawMessage: string) => {
      this.execAsync(async () => {
        const message = JSON.parse(rawMessage) as IncommingMessage;
        await cb(message);
      });
    });
  }

  public onError(cb: (error: any) => Promise<void> | void): void {
    this.onErrorCb = cb;
  }

  public send(data: OutgoingMessage): void {
    this.execAsync(async () => {
      await new Promise((res, rej) => {
        try {
          this.conn.send(JSON.stringify(data), {}, res);
        } catch (error) {
          rej(error);
        }
      });
    });
  }

  public terminate(): void {
    this.conn.terminate();
  }

  public close(): void {
    this.conn.close();
  }

  protected execAsync(func: (...args: any[]) => Promise<void> | void): void {
    this.queue.push(func);
    this.drainQueue();
  }

  protected async handleError(error: any): Promise<void> {
    if (this.onErrorCb) {
      await this.onErrorCb(error);
    } else {
      logger.error('WebSocket error');
    }
    this.queue = [];
  }

  private drainQueue(): void {
    if (!this.draining) {
      this.draining = true;
      const run = async (): Promise<void> => {
        while (this.queue.length > 0) {
          const first = this.queue.shift();
          if (first) {
            try {
              await first();
            } catch (error) {
              await this.handleError(error);
            }
          }
        }
        this.draining = false;
      };
      void run();
    }
  }
}

export class WebSocketServer<IncommingMessage = any, OutgoingMessage = any> extends WebSocketBase<
  IncommingMessage,
  OutgoingMessage
> {
  private isWsAlive = true;
  private readonly pingInterval: NodeJS.Timeout;

  constructor(ws: WebSocket) {
    super(ws);
    this.pingInterval = setInterval(() => {
      if (this.isWsAlive === false) {
        ws.terminate();
        return;
      }

      this.isWsAlive = false;
      ws.ping(() => null);
    }, PING_TIMEOUT_MS);
    ws.on('pong', () => {
      this.isWsAlive = true;
    });
  }

  public onClose(cb: () => Promise<void> | void): void {
    this.conn.on('close', () => {
      clearInterval(this.pingInterval);
      this.execAsync(cb);
    });
  }
}
