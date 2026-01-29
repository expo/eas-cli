import { createLogger } from './logger';

const handlers: (() => void | Promise<void>)[] = [];
let shouldExitStatus = false;

export function listenForInterrupts(): void {
  let handlerInProgress = false;
  const handleExit = async (): Promise<void> => {
    try {
      // when eas-cli calls childProcess.kill() local build receives
      // signal twice in some cases
      if (handlerInProgress) {
        return;
      }
      handlerInProgress = true;
      createLogger().error({ phase: 'ABORT' }, 'Received termination signal.');
      shouldExitStatus = true;
      await Promise.allSettled(
        handlers.map((handler) => {
          return handler();
        })
      );
    } finally {
      handlerInProgress = false;
    }
    process.exit(1);
  };

  process.on('SIGTERM', handleExit);
  process.on('SIGINT', handleExit);
}

export function registerHandler(fn: () => void | Promise<void>): void {
  handlers.push(fn);
}

export function shouldExit(): boolean {
  return shouldExitStatus;
}
