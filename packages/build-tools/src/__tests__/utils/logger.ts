import { bunyan } from '@expo/logger';

export function createMockLogger({ logToConsole = false } = {}): bunyan {
  const logger = {
    info: jest.fn(logToConsole ? console.info : () => {}),
    debug: jest.fn(logToConsole ? console.debug : () => {}),
    error: jest.fn(logToConsole ? console.error : () => {}),
    warn: jest.fn(logToConsole ? console.warn : () => {}),
    child: jest.fn().mockImplementation(() => createMockLogger({ logToConsole })),
  } as unknown as bunyan;
  return logger;
}
