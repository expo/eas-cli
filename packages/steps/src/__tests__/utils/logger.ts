import { bunyan } from '@expo/logger';
import { jest } from '@jest/globals';

export function createMockLogger(): bunyan {
  const logger = {
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    child: jest.fn().mockImplementation(() => createMockLogger()),
  } as unknown as bunyan;
  return logger;
}

// `child()` returns this instance so per-step logs stay in the same sink.
export function createRecordingLogger(sink: string[]): bunyan {
  const record = (...args: unknown[]): void => {
    const message = args.find(arg => typeof arg === 'string');
    if (typeof message === 'string') {
      sink.push(message);
    }
  };
  const logger = {
    info: jest.fn(record),
    debug: jest.fn(record),
    error: jest.fn(record),
    warn: jest.fn(record),
    child: jest.fn(() => logger),
  } as unknown as bunyan;
  return logger;
}
