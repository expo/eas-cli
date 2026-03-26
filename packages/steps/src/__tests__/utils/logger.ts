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
